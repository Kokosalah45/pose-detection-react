import '@tensorflow/tfjs-backend-webgl'
import * as tfCore from '@tensorflow/tfjs-core'

import {
  type Pose,
  type PoseDetector,
  type PosenetModelConfig,
  createDetector as createPoseDetector,
  SupportedModels as SupportedPoseModels,
} from '@tensorflow-models/pose-detection'

import {
  FaceLandmarksDetector,
  type Face,
  SupportedModels as SupportedFaceLandmarksModels,
  type MediaPipeFaceMeshMediaPipeModelConfig,
  createDetector as createFaceLandmarksDetector,
} from '@tensorflow-models/face-landmarks-detection'
import { useEffect, useRef, useState } from 'react'

const CAMERA_DIMENSIONS = {
  width: 350,
  height: 350,
}
const POSE_DETECTOR_CONFIG: PosenetModelConfig = {
  architecture: 'MobileNetV1',
  outputStride: 16,
  multiplier: 0.75,
  quantBytes: 4,
  inputResolution: {
    width: CAMERA_DIMENSIONS.width,
    height: CAMERA_DIMENSIONS.height,
  },
}

const FACE_LANDMARKS_CONFIG: MediaPipeFaceMeshMediaPipeModelConfig = {
  runtime: 'mediapipe',
  maxFaces: 1,
  refineLandmarks: true,
  solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh',
}

const CONFIDENCE_THRESHOLD = 0.98

type ScanStages = 'front' | 'left' | 'right'

const downloadImage = async (canvas: HTMLCanvasElement) => {
  const imageData = canvas.toDataURL('image/png')
  const link = document.createElement('a')
  link.href = imageData
  link.download = 'image.png'
  link.click()

  link.remove()
}
function drawPortraitOval(canvas: HTMLCanvasElement) {
  if (canvas.getContext) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('No Context Found')

    const centerX = canvas.width / 2
    const centerY = canvas.height / 2

    const radiusX = canvas.width * 0.25 // 25% of canvas width
    const radiusY = radiusX * 1.33 // 4:3 ratio for face proportions

    ctx.beginPath()
    ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI)
    ctx.lineWidth = 3
    ctx.strokeStyle = 'green'
    ctx.stroke()
  }
}

type FacePositionSuccessResult = {
  isValid: true
  reason: null
}
type FacePositionFailResult = {
  isValid: false
  reason:
    | 'FACE_CLOSE'
    | 'FACE_FAR'
    | 'FACE_UP'
    | 'FACE_DOWN'
    | 'NO_FACE'
    | 'FACE_RIGHT'
    | 'FACE_LEFT'
}

type PoseValidationSuccessResult = {
  isValid: true
  reason: null
}

type PoseValidationFailResult = {
  isValid: false
  reason:
    | 'MISSING_FRONT_FEATURES'
    | 'LOW_CONFIDENCE_FRONT'
    | 'RIGHT_EYE_VISIBLE_IN_LEFT'
    | 'MISSING_LEFT_FEATURES'
    | 'LOW_CONFIDENCE_LEFT'
    | 'LEFT_EYE_VISIBLE_IN_RIGHT'
    | 'MISSING_RIGHT_FEATURES'
    | 'LOW_CONFIDENCE_RIGHT'
}
const isFaceInOval = (
  face: Face,
  canvasEl: HTMLCanvasElement,
): FacePositionSuccessResult | FacePositionFailResult => {
  if (!face.box) return { isValid: false, reason: 'NO_FACE' }

  const centerX = canvasEl.width / 2
  const centerY = canvasEl.height / 2
  const radiusX = canvasEl.width * 0.25
  const radiusY = radiusX * 1.33

  const faceWidthRatio = face.box.width / canvasEl.width

  if (faceWidthRatio < 0.35) {
    return { isValid: false, reason: 'FACE_FAR' }
  }
  if (faceWidthRatio > 0.5) {
    return { isValid: false, reason: 'FACE_CLOSE' }
  }

  // Check vertical position
  const faceCenterY = (face.box.yMax + face.box.yMin) / 2
  const verticalOffset = faceCenterY - centerY // de 3a4an el direction
  const toleranceY = radiusY * 0.35
  if (Math.abs(verticalOffset) > toleranceY) {
    return {
      isValid: false,
      reason: verticalOffset > 0 ? 'FACE_DOWN' : 'FACE_UP',
    }
  }

  const faceCenterX = (face.box.xMax + face.box.xMin) / 2

  const horizontalOffset = faceCenterX - centerX
  const toleranceX = radiusX * 0.4
  if (Math.abs(horizontalOffset) > toleranceX) {
    return {
      isValid: false,
      reason: horizontalOffset > 0 ? 'FACE_RIGHT' : 'FACE_LEFT',
    }
  }

  return { isValid: true, reason: null }
}

const drawFrame = (videoEl: HTMLVideoElement, canvasEl: HTMLCanvasElement) => {
  const ctx = canvasEl.getContext('2d')
  if (!ctx) throw new Error('Failed to get canvas context')

  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height)
  ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height)
  drawPortraitOval(canvasEl)

  requestAnimationFrame(() => drawFrame(videoEl, canvasEl))
}

const getPoses = async (detector: PoseDetector, videoEl: HTMLVideoElement) => {
  const poses = await detector.estimatePoses(videoEl, {
    flipHorizontal: true,
  })

  return poses
}

const isPoseValid = (
  poseArr: Pose[],
  currentScanStage: ScanStages,
): PoseValidationSuccessResult | PoseValidationFailResult => {
  const pose = poseArr[0]

  if (currentScanStage === 'front') {
    const neededFrontPoses = ['left_eye', 'right_eye', 'nose']
    const frontPoses = pose.keypoints.filter(pose =>
      neededFrontPoses.includes(pose.name || ''),
    )

    if (frontPoses.length !== neededFrontPoses.length) {
      return { isValid: false, reason: 'MISSING_FRONT_FEATURES' }
    }
    console.log('frontPoses', frontPoses)

    if (frontPoses.some(pose => (pose.score ?? 0) < CONFIDENCE_THRESHOLD)) {
      return { isValid: false, reason: 'LOW_CONFIDENCE_FRONT' }
    }

    return { isValid: true, reason: null }
  }

  if (currentScanStage === 'left') {
    const neededLeftPoses = ['left_eye', 'nose']
    const rightEye = pose.keypoints.find(pose => pose.name === 'right_eye')

    if (rightEye && (rightEye.score ?? 0) >= CONFIDENCE_THRESHOLD) {
      return { isValid: false, reason: 'RIGHT_EYE_VISIBLE_IN_LEFT' }
    }

    const leftPoses = pose.keypoints.filter(pose =>
      neededLeftPoses.includes(pose.name || ''),
    )

    if (leftPoses.length !== neededLeftPoses.length) {
      return { isValid: false, reason: 'MISSING_LEFT_FEATURES' }
    }

    if (leftPoses.some(pose => (pose.score ?? 0) < CONFIDENCE_THRESHOLD)) {
      return { isValid: false, reason: 'LOW_CONFIDENCE_LEFT' }
    }

    return { isValid: true, reason: null }
  }

  if (currentScanStage === 'right') {
    const neededRightPoses = ['right_eye', 'nose']
    const leftEye = pose.keypoints.find(pose => pose.name === 'left_eye')

    if (leftEye && (leftEye.score ?? 0) >= CONFIDENCE_THRESHOLD) {
      return { isValid: false, reason: 'LEFT_EYE_VISIBLE_IN_RIGHT' }
    }

    const rightPoses = pose.keypoints.filter(pose =>
      neededRightPoses.includes(pose.name || ''),
    )

    if (rightPoses.length !== neededRightPoses.length) {
      return { isValid: false, reason: 'MISSING_RIGHT_FEATURES' }
    }

    if (rightPoses.some(pose => (pose.score ?? 0) < CONFIDENCE_THRESHOLD)) {
      return { isValid: false, reason: 'LOW_CONFIDENCE_RIGHT' }
    }

    return { isValid: true, reason: null }
  }

  return { isValid: false, reason: 'MISSING_FRONT_FEATURES' }
}
const getLandmarks = async (
  detector: FaceLandmarksDetector,
  videoEl: HTMLVideoElement,
) => {
  const landmarks = await detector.estimateFaces(videoEl, {
    flipHorizontal: true,
  })

  return landmarks
}

const createDetectors = async ({
  poseConfig,
  faceLandmarksConfig,
}: {
  poseConfig: PosenetModelConfig
  faceLandmarksConfig: MediaPipeFaceMeshMediaPipeModelConfig
}) => {
  const [poseModel, faceLandmarksModel] = await Promise.allSettled([
    createPoseDetector(SupportedPoseModels.PoseNet, poseConfig),
    createFaceLandmarksDetector(
      SupportedFaceLandmarksModels.MediaPipeFaceMesh,
      faceLandmarksConfig,
    ),
  ])

  if (
    poseModel.status === 'rejected' ||
    faceLandmarksModel.status === 'rejected'
  ) {
    throw new Error('Failed to init models')
  }

  return {
    poseDetector: poseModel.value,
    faceLandmarksDetector: faceLandmarksModel.value,
  }
}

export default function PoseDetection() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const detectorsRef = useRef<{
    poseDetector: PoseDetector
    faceLandmarksDetector: FaceLandmarksDetector
  } | null>(null)

  const [isCapturing, setIsCapturing] = useState(false)

  useEffect(() => {
    const startCamera = async () => {
      try {
        const videoEl = videoRef.current
        const canvasEl = canvasRef.current
        if (!videoEl || !canvasEl) {
          return
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            frameRate: {
              ideal: 30,
            },
            width: CAMERA_DIMENSIONS.width,
            height: CAMERA_DIMENSIONS.height,
          },
        })

        videoEl.srcObject = stream

        await videoEl.play()

        drawFrame(videoEl, canvasEl)
      } catch (error) {
        console.log(error)
      }
    }
    startCamera()
  }, [])

  useEffect(() => {
    const setupBackend = async () => {
      await tfCore.setBackend('webgl')
      await tfCore.ready()
    }
    setupBackend()
  }, [])

  return (
    <section>
      <div
        style={{
          position: 'relative',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <canvas
          ref={canvasRef}
          {...CAMERA_DIMENSIONS}
          style={{
            transform: 'scaleX(-1)',
          }}
        />
        <video
          ref={videoRef}
          {...CAMERA_DIMENSIONS}
          style={{ display: 'none' }}
        />
      </div>
      <button
        disabled={isCapturing}
        onClick={async () => {
          try {
            setIsCapturing(true)
            let detectors = detectorsRef.current
            if (detectors === null) {
              detectorsRef.current = await createDetectors({
                poseConfig: POSE_DETECTOR_CONFIG,
                faceLandmarksConfig: FACE_LANDMARKS_CONFIG,
              })
              detectors = detectorsRef.current
            }

            const videoEl = videoRef.current
            const canvasEl = canvasRef.current

            if (!videoEl || !canvasEl) return

            const landmarks = await getLandmarks(
              detectors.faceLandmarksDetector,
              videoEl,
            )

            if (landmarks.length === 0) {
              throw new Error('No Face Detected')
            }
            const facePosition = isFaceInOval(landmarks[0], canvasEl)
            console.log('Face data:', facePosition)

            if (!facePosition.isValid) {
              console.log('Adjustment needed:', facePosition.reason)
              alert(facePosition.reason)
              return
            }
            const poses = await getPoses(detectors.poseDetector, videoEl)

            if (poses.length === 0) {
              throw new Error('NO FACE DETECTED')
            }
            const poseValidation = isPoseValid(poses, 'front')
            if (!poseValidation.isValid) {
              console.log('Adjustment needed:', poseValidation.reason)
              alert(facePosition.reason)
              return
            }
            downloadImage(canvasEl)
          } catch (error) {
            console.error(error)
          } finally {
            setIsCapturing(false)
          }
        }}
        style={{ marginBlock: '1rem' }}
      >
        {!isCapturing ? 'Capture' : 'Capturing...'}
      </button>
    </section>
  )
}
