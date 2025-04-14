import { useRef, useEffect, useReducer, useCallback } from 'react'

type ScanStagesViews = 'front' | 'left' | 'right'
type ScanStageState = 'completed' | 'scanning' | 'initial'

type ScanStages = {
  stage: ScanStagesViews
  stageState: ScanStageState
  isError?: boolean
  error?: ScanStageErrorReasons
}

type ScanStageErrorReasons = 'TIMEOUT' | 'VALIDATION_ERROR'
type ScanErrorStates = 'SCAN_TIMEOUT' | 'NUMBER_OF_ATTEMPTS_EXCEED'

type ScanState =
  | { status: 'idle' }
  | { status: 'scanning' }
  | { status: 'error'; error: ScanErrorStates }
  | { status: 'completed' }

type ScanAction =
  | { type: 'START_SCAN' }
  | { type: 'STOP_SCAN' }
  | { type: 'RESTART_SCAN' }
  | { type: 'SCAN_COMPLETED' }
  | { type: 'SCAN_ERROR'; error: ScanErrorStates }
  | { type: 'STAGE_COMPLETED' }
  | { type: 'STAGE_ERROR'; error: ScanStageErrorReasons }
  | { type: 'SET_TRANSITIONING'; isTransitioning: boolean }
  | { type: 'DECREASE_ATTEMPTS' }

type LivenessState = {
  scanState: ScanState
  currentActiveStage: ScanStages
  currentAttemptNumber: number
  isScanActive: boolean
  isTransitioning: boolean
  stages: ScanStages[]
}

const INITIAL_SCAN_STAGES: ScanStages[] = [
  { stage: 'front', stageState: 'initial' },
  { stage: 'left', stageState: 'initial' },
  { stage: 'right', stageState: 'initial' },
]

const INITIAL_SCAN_STATE: ScanState = { status: 'idle' }

function shuffleArray<T>(array: T[]): T[] {
  const newArray = [...array]
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[newArray[i], newArray[j]] = [newArray[j], newArray[i]]
  }
  return newArray
}

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

type Props = {
  videoEl: HTMLVideoElement
  scanStageTransitionTime: number
  scanStageTimeoutTime: number
  scanTimeoutTime: number
  numberOfAttempts: number
  state: ScanStageState
  detector: any
  onScanCompleted: () => void
  onScanError: () => void
  onScanStageError: () => void
  onScanStageCompleted: () => void
}

export default function useLivenessDetection(props: Props) {
  const initialState: LivenessState = {
    scanState: INITIAL_SCAN_STATE,
    currentActiveStage: shuffleArray([...INITIAL_SCAN_STAGES])[0],
    currentAttemptNumber: 1,
    isScanActive: false,
    isTransitioning: false,
    stages: shuffleArray([...INITIAL_SCAN_STAGES]),
  }

  function scanReducer(
    state: LivenessState,
    action: ScanAction,
  ): LivenessState {
    switch (action.type) {
      case 'START_SCAN':
        return {
          ...state,
          scanState: { status: 'scanning' },
          isScanActive: true,
        }
      case 'STOP_SCAN':
        return {
          ...initialState,
          stages: shuffleArray([...INITIAL_SCAN_STAGES]),
        }
      case 'RESTART_SCAN':
        // eslint-disable-next-line no-case-declarations
        const restartStages = shuffleArray([...INITIAL_SCAN_STAGES])
        return {
          ...initialState,
          scanState: { status: 'scanning' },
          isScanActive: true,
          currentAttemptNumber: 1,
          stages: restartStages,
          currentActiveStage: restartStages[0],
        }
      case 'SCAN_COMPLETED':
        return {
          ...state,
          scanState: { status: 'completed' },
          isScanActive: false,
        }
      case 'SCAN_ERROR':
        return {
          ...state,
          scanState: { status: 'error', error: action.error },
          isScanActive: false,
        }
      case 'STAGE_COMPLETED': {
        const newStages = [...state.stages.slice(1)]
        return {
          ...state,
          stages: newStages,
          currentActiveStage:
            newStages.length > 0
              ? { ...newStages[0], stageState: 'initial' }
              : state.currentActiveStage,
        }
      }
      case 'STAGE_ERROR': {
        const updatedStage = {
          ...state.currentActiveStage,
          isError: true,
          error: action.error,
        }
        const newStages = [updatedStage, ...state.stages.slice(1)]
        return {
          ...state,
          stages: newStages,
          currentActiveStage: updatedStage,
          currentAttemptNumber: state.currentAttemptNumber + 1,
        }
      }
      case 'SET_TRANSITIONING':
        return {
          ...state,
          isTransitioning: action.isTransitioning,
        }
      case 'DECREASE_ATTEMPTS':
        return {
          ...state,
          currentAttemptNumber: state.currentAttemptNumber + 1,
        }
      default:
        return state
    }
  }

  const [state, dispatch] = useReducer(scanReducer, initialState)

  const scanStartTimeStamp = useRef<number | null>(null)
  const scanStageStartTimeStamp = useRef<number | null>(null)
  const rafID = useRef<number | null>(null)
  const isStopScanSignal = useRef<boolean>(false)
  const remainingAttempts = useRef<number>(props.numberOfAttempts)

  const cleanUp = useCallback(() => {
    if (rafID.current) {
      cancelAnimationFrame(rafID.current)
      rafID.current = null
    }
    isStopScanSignal.current = true
  }, [])

  useEffect(() => {
    return () => {
      cleanUp()
    }
  }, [cleanUp])

  const validator = async (): Promise<boolean> => {
    try {
      await sleep(3000)
      return Math.random() > 0.5
    } catch (error) {
      console.error('Validation error:', error)
      return false
    }
  }

  const scheduleScan = useCallback(() => {
    dispatch({ type: 'SET_TRANSITIONING', isTransitioning: true })

    const transitionTimer = setTimeout(() => {
      dispatch({ type: 'SET_TRANSITIONING', isTransitioning: false })
      isStopScanSignal.current = false
      startScan()
    }, props.scanStageTransitionTime)

    return () => clearTimeout(transitionTimer)
  }, [props.scanStageTransitionTime])

  const moveToNextStage = useCallback(() => {
    dispatch({ type: 'STAGE_COMPLETED' })
    scanStageStartTimeStamp.current = null
    cleanUp()

    if (state.stages.length <= 1) {
      dispatch({ type: 'SCAN_COMPLETED' })
      props.onScanCompleted()
      return
    }

    scheduleScan()
  }, [state.stages.length, props, cleanUp, scheduleScan])

  const startScan = useCallback(async () => {
    if (isStopScanSignal.current) {
      return
    }

    if (scanStartTimeStamp.current === null) {
      scanStartTimeStamp.current = Date.now()
      dispatch({ type: 'START_SCAN' })
    }

    if (state.stages.length === 0) {
      props.onScanCompleted()
      dispatch({ type: 'SCAN_COMPLETED' })
      cleanUp()
      return
    }

    const currentTime = Date.now()
    if (scanStartTimeStamp.current) {
      const timeDiff = currentTime - scanStartTimeStamp.current
      const isAttemptLimitReached = remainingAttempts.current <= 0

      if (timeDiff > props.scanTimeoutTime || isAttemptLimitReached) {
        cleanUp()
        dispatch({
          type: 'SCAN_ERROR',
          error: isAttemptLimitReached
            ? 'NUMBER_OF_ATTEMPTS_EXCEED'
            : 'SCAN_TIMEOUT',
        })
        props.onScanError()
        return
      }
    }

    const currentStage = state.currentActiveStage

    if (currentStage.stageState === 'initial') {
      currentStage.stageState = 'scanning'
      scanStageStartTimeStamp.current = Date.now()
    }

    if (currentStage.stageState === 'scanning') {
      if (!scanStageStartTimeStamp.current) {
        scanStageStartTimeStamp.current = Date.now()
      }

      const stageTimeDiff = currentTime - scanStageStartTimeStamp.current
      const isStageTimeout = stageTimeDiff > props.scanStageTimeoutTime

      try {
        if (isStageTimeout) {
          remainingAttempts.current--
          dispatch({ type: 'STAGE_ERROR', error: 'TIMEOUT' })
          dispatch({ type: 'DECREASE_ATTEMPTS' })
          props.onScanStageError()
        } else {
          const isValid = await validator()

          if (isValid) {
            currentStage.stageState = 'completed'
            props.onScanStageCompleted()
            moveToNextStage()
            return
          } else {
            remainingAttempts.current--
            dispatch({ type: 'STAGE_ERROR', error: 'VALIDATION_ERROR' })
            props.onScanStageError()
          }
        }
      } catch (error) {
        console.error('Error during scanning:', error)
        remainingAttempts.current--
        dispatch({ type: 'STAGE_ERROR', error: 'VALIDATION_ERROR' })
        props.onScanStageError()
      }
    }

    rafID.current = requestAnimationFrame(startScan)
  }, [state.stages, state.currentActiveStage, props, moveToNextStage, cleanUp])

  const stopScan = useCallback(() => {
    cleanUp()
    dispatch({ type: 'STOP_SCAN' })
    scanStartTimeStamp.current = null
    scanStageStartTimeStamp.current = null
    remainingAttempts.current = props.numberOfAttempts
    props.onScanError()
  }, [props, cleanUp])

  const restartScan = useCallback(() => {
    cleanUp()
    scanStartTimeStamp.current = null
    scanStageStartTimeStamp.current = null
    remainingAttempts.current = props.numberOfAttempts
    dispatch({ type: 'RESTART_SCAN' })

    setTimeout(() => {
      startScan()
    }, 0)
  }, [props.numberOfAttempts, startScan, cleanUp])

  return {
    scanStages: state.stages,
    currentActiveStage: state.currentActiveStage,
    currentAttemptNumber: state.currentAttemptNumber,
    isScanActive: state.isScanActive,
    isTransitioning: state.isTransitioning,
    scanState: state.scanState,
    startScan,
    stopScan,
    restartScan,
  }
}
