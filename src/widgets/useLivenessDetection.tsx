import { useRef, useState } from 'react'

type ScanStagesViews = 'front' | 'left' | 'right'
type ScanStageState = 'error' | 'completed' | 'scanning' | 'initial'

type ScanStages = {
  stage: ScanStagesViews
  stageState: ScanStageState
}

type ErrorStates = {
  error: 'STAGE_TIMEOUT' | 'SCAN_TIMEOUT' | 'VALIDATION_ERROR'
  errorMessage: string
}

const SCAN_STAGES: ScanStages[] = [
  { stage: 'front', stageState: 'initial' },
  { stage: 'left', stageState: 'initial' },
  { stage: 'right', stageState: 'initial' },
]

type Props = {
  videoEl: HTMLVideoElement
  onScanCompleted: () => void
  onScanError: () => void
  onScanStageError: () => void
  onScanStageChange: (stage: ScanStages) => void
  onScanStageCompleted: () => void
  scanStageTransitionTime: number
  scanStageTimeoutTime: number
  scanTimeoutTime: number
  numberOfAttempts: number
  state: ScanStageState
  detector: any
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const shuffleArray = (array: ScanStages[]) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[array[i], array[j]] = [array[j], array[i]]
  }
  return array
}

export default function useLivenessDetection(props: Props) {
  // runtime state to manage scanning
  const scanStartTimeStamp = useRef<number | null>(null)
  const scanStageStartTimeStamp = useRef<number | null>(null)
  const rafID = useRef<number | null>(null)
  const scanStages = useRef<ScanStages[]>(shuffleArray(SCAN_STAGES))
  const isStopScanSignal = useRef<boolean>(false)
  const remainingAttempts = useRef<number>(props.numberOfAttempts)

  // acts as notifications of changes in runtime state to the UI
  const [currentActiveStage, setCurrentActiveStage] = useState<ScanStages>(
    scanStages.current[0],
  )
  const [currentAttemptNumber, setCurrentAttemptNumber] = useState<number>(
    props.numberOfAttempts - remainingAttempts.current + 1,
  )
  const [isScanActive, setIsScanActive] = useState<boolean>(false)
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false)

  const resetStates = () => {
    scanStartTimeStamp.current = null
    scanStageStartTimeStamp.current = null
    isStopScanSignal.current = false
    scanStages.current.forEach(stage => {
      stage.stageState = 'initial'
    })
    remainingAttempts.current = numberOfAttempts

    setCurrentActiveStage(scanStages.current[0])
    setCurrentAttemptNumber(
      props.numberOfAttempts - remainingAttempts.current + 1,
    )
    setIsScanActive(false)
    setIsTransitioning(false)
  }

  const sendStopSignal = () => {
    isStopScanSignal.current = true
  }
  const {
    videoEl,
    scanStageTransitionTime,
    scanStageTimeoutTime,
    scanTimeoutTime,
    numberOfAttempts,
  } = props

  const validator = async () => {
    await sleep(3000)
    // validating logic
  }

  const startScan = async () => {
    if (isStopScanSignal.current) {
      return
    }

    if (scanStartTimeStamp.current === null) {
      scanStartTimeStamp.current = Date.now()
    }

    const currentStage = scanStages.current[0]
    const currentTime = Date.now()
    const timeDiff = currentTime - scanStartTimeStamp.current

    const isAttemptLimitReached = remainingAttempts.current === 0

    if (timeDiff > scanTimeoutTime || isAttemptLimitReached) {
      stopScan()
      return
    }

    if (currentStage.stageState === 'initial') {
      currentStage.stageState = 'scanning'
      setCurrentActiveStage(currentStage)
      scanStageStartTimeStamp.current = Date.now()
    }

    if (currentStage.stageState === 'scanning') {
      if (!scanStageStartTimeStamp.current) {
        throw new Error('scanStageStartTimeStamp.current is null')
      }
      const stageTimeDiff = currentTime - scanStageStartTimeStamp.current
      const isStageTimeout = stageTimeDiff > scanStageTimeoutTime

      if (isStageTimeout) {
        currentStage.stageState = 'error'
        setCurrentActiveStage(currentStage)
      } else {
        const validationState = await validator()
      }
    }

    // validate here

    requestAnimationFrame(startScan)
  }

  const stopScan = () => {
    sendStopSignal()
    if (rafID.current) {
      cancelAnimationFrame(rafID.current)
    }
    resetStates()
  }

  return {
    startScan,
    stopScan,
    scanStages,
    currentActiveStage,
    remainingAttempts,
    isScanActive,
    isTransitioning,
  }
}
