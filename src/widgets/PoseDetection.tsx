import type { MediaPipeFaceMeshMediaPipeModelConfig, FaceLandmarksDetector } from '@tensorflow-models/face-landmarks-detection'
import { useCallback, useState } from 'react'

const CAMERA_DIMENSIONS = {
  width: 400,
  height: 400,
}

const DETECTOR_CONFIG: MediaPipeFaceMeshMediaPipeModelConfig = {
  runtime: 'mediapipe',
  solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh',
  maxFaces: 1,
  refineLandmarks: true,
}



const getCameraStream = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: 'user',
      frameRate: { ideal: 30 },
      width: CAMERA_DIMENSIONS.width,
      height: CAMERA_DIMENSIONS.height,
    },
  })
  return stream
}

const initVideo = async (videoEl: HTMLVideoElement, videoStream: MediaStream) => {
  videoEl.srcObject = videoStream
  return new Promise<void>(resolve => {
    videoEl.onloadedmetadata = () => {
      videoEl.play().then(resolve)
    }
  })
}

const initCanvas = (canvasEl: HTMLCanvasElement, videoEl: HTMLVideoElement) => {
  canvasEl.style.width = videoEl.videoWidth + 'px'
  canvasEl.style.height = videoEl.videoHeight + 'px'
  canvasEl.width = videoEl.videoWidth
  canvasEl.height = videoEl.videoHeight
}

const createDetector = async () => {
  const tfCore = await import('@tensorflow/tfjs-core')
  await import('@tensorflow/tfjs-backend-webgl')
  await tfCore.setBackend('webgl')
  await tfCore.ready()

  const faceLandmarksDetection = await import('@tensorflow-models/face-landmarks-detection')
  const model = faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh

  return faceLandmarksDetection.createDetector(model, DETECTOR_CONFIG)
}

const drawCenterFrame = (canvas: HTMLCanvasElement, videoEl: HTMLVideoElement) => {
  const centerX = videoEl.videoWidth / 2
  const centerY = videoEl.videoHeight / 2
  const frameSize = videoEl.videoWidth / 1.8
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to get canvas context')

  ctx.strokeStyle = 'red'
  ctx.lineWidth = 4
  ctx.strokeRect(centerX - frameSize / 2, centerY - frameSize / 2, frameSize, frameSize)
}

const drawFrame = (videoEl: HTMLVideoElement, canvasEl: HTMLCanvasElement) => {
  const ctx = canvasEl.getContext('2d')
  if (!ctx) throw new Error('Failed to get canvas context')

  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height)
  ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height)
  drawCenterFrame(canvasEl, videoEl)

  requestAnimationFrame(() => drawFrame(videoEl, canvasEl))
}

export default function PoseDetection() {
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null)
  const [detector, setDetector] = useState<FaceLandmarksDetector | null>(null)
  
  const initCamera = useCallback(async () => {
    try {
      if (!videoEl || !canvasEl) return
      const stream = await getCameraStream()
      await initVideo(videoEl, stream)
      initCanvas(canvasEl, videoEl)
      drawFrame(videoEl, canvasEl)
    } catch (error) {
      console.log(error)
    }
  }, [videoEl, canvasEl])

  return (
    <section>
      <div
        style={{
          position: 'relative',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          width: CAMERA_DIMENSIONS.width,
          height: CAMERA_DIMENSIONS.height,
        }}
      >
        <video
          width={CAMERA_DIMENSIONS.width}
          height={CAMERA_DIMENSIONS.height}
          ref={node => {
            if (node && !videoEl) setVideoEl(node)
          }}
          style={{ display: 'none' }}
        />
        <canvas
          style={{ transform: 'scaleX(-1)' }}
          ref={node => {
            if (node && !canvasEl) setCanvasEl(node)
          }}
        />
      </div>
      {/* {!isScanProcessOnGoing && (
        <button
          style={{ marginBlock: '1rem' }}
          onClick={async () => {
            const detector = await createDetector()
            await initCamera()
            setDetector(detector)
            const shuffledStages = shuffleArray([...AVAILABE_SCAN_STAGES])
            setScanStages(shuffledStages)
          }}
          disabled={!isNodesMounted}
        >
          {!isNodesMounted ? 'Loading...' : 'Start Scan'}
        </button>
      )} */}
    </section>
  )
}
