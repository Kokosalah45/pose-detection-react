import "@tensorflow/tfjs-backend-webgl";
import * as tf from "@tensorflow/tfjs-core";

import * as poseDetection from "@tensorflow-models/pose-detection";
import { useEffect, useRef, useState } from "react";

const CAMERA_DIMENSIONS = {
  width: 400,
  height: 400,
};

const CONFIDENCE_THRESHOLD = 0.7;

const getPoses = async (
  detector: poseDetection.PoseDetector,
  videoEl: HTMLVideoElement
) => {
  const poses = await detector.estimatePoses(videoEl, {
    maxPoses: 1,
    flipHorizontal: true,
    scoreThreshold: 0.2,
    nmsRadius: 20,
  });

  return poses;
};

type ScanStages = "front" | "left" | "right" | "success";

const isPointInBorder = (
  borderRect: DOMRect,
  videoRect: DOMRect,
  point: { x: number; y: number }
) => {
  if (!videoRect) return false;

  const relativeX = borderRect.x - videoRect.x;
  const relativeY = borderRect.y - videoRect.y;

  return (
    point.x >= relativeX &&
    point.x <= relativeX + borderRect.width &&
    point.y >= relativeY &&
    point.y <= relativeY + borderRect.height
  );
};

const isFaceInBorder = (
  poseArr: poseDetection.Pose[],
  currentScanStage: ScanStages,
  borderRect: DOMRect,
  videoRect: DOMRect
) => {
  const pose = poseArr[0];
  if (currentScanStage === "front") {
    const neededFrontPoses = ["left_eye", "right_eye", "nose"];

    const frontPoses = pose.keypoints.filter((pose) =>
      neededFrontPoses.includes(pose.name || "")
    );

    if (frontPoses.length !== neededFrontPoses.length) {
      return false;
    }

    if (frontPoses.some((pose) => (pose.score ?? 0) < CONFIDENCE_THRESHOLD)) {
      return false;
    }

    return frontPoses.every((pose) =>
      isPointInBorder(borderRect, videoRect, {
        x: pose.x,
        y: pose.y,
      })
    );
  }
  
  if (currentScanStage === "left") {
    const neededLeftPoses = ["left_eye", "nose"];
    
    const rightEye = pose.keypoints.find((pose) => pose.name === "right_eye");
    
    if (rightEye && (rightEye.score ?? 0) >= CONFIDENCE_THRESHOLD) {
      return false; 
    }

    const leftPoses = pose.keypoints.filter((pose) =>
      neededLeftPoses.includes(pose.name || "")
    );

    if (leftPoses.length !== neededLeftPoses.length) {
      return false;
    }

    if (leftPoses.some((pose) => (pose.score ?? 0) < CONFIDENCE_THRESHOLD)) {
      return false;
    }

    return leftPoses.every((pose) =>
      isPointInBorder(borderRect, videoRect, {
        x: pose.x,
        y: pose.y,
      })
    );
  }

  if (currentScanStage === "right") {
    // For right side view, right_eye and nose should be visible with high confidence
    const neededRightPoses = ["right_eye", "nose"];
    
    // The left eye should have low confidence or not be detected properly
    const leftEye = pose.keypoints.find((pose) => pose.name === "left_eye");
    
    // If left eye has high confidence, this is not a proper side view
    if (leftEye && (leftEye.score ?? 0) >= CONFIDENCE_THRESHOLD) {
      return false; // Both eyes visible with high confidence - not a proper right side view
    }

    const rightPoses = pose.keypoints.filter((pose) =>
      neededRightPoses.includes(pose.name || "")
    );

    if (rightPoses.length !== neededRightPoses.length) {
      return false;
    }

    if (rightPoses.some((pose) => (pose.score ?? 0) < CONFIDENCE_THRESHOLD)) {
      return false;
    }

    return rightPoses.every((pose) =>
      isPointInBorder(borderRect, videoRect, {
        x: pose.x,
        y: pose.y,
      })
    );
  }

  return false;
};
export default function PoseDetection() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const detectorRef = useRef<poseDetection.PoseDetector | null>(null);
  const centerFrameRef = useRef<HTMLDivElement | null>(null);
  const imageCaptureRef = useRef<ImageCapture | null>(null);

  const [scanStage , setScanStages] = useState<ScanStages>("front");

  useEffect(() => {
    const startCamera = async () => {
      try {
        const videoEl = videoRef.current;
        if (!videoEl) {
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            frameRate: {
              ideal: 30,
            },
            width: CAMERA_DIMENSIONS.width,
            height: CAMERA_DIMENSIONS.height,
          },
        });

        videoEl.srcObject = stream;
        const track = stream.getVideoTracks()[0];
        imageCaptureRef.current = new ImageCapture(track);

        await videoEl.play();

        // setup tensor flow
        await tf.setBackend("webgl");
        await tf.ready();

        const detector = await poseDetection.createDetector(
          poseDetection.SupportedModels.PoseNet,
          {
            architecture: "MobileNetV1",
            outputStride: 16,

            inputResolution: {
              width: CAMERA_DIMENSIONS.width,
              height: CAMERA_DIMENSIONS.height,
            },
          }
        );

        detectorRef.current = detector;
      } catch (error) {
        console.log(error);
      }
    };
    startCamera();
  }, []);

  return (
    <section>
      <h2>Current Scan Stage: {scanStage}</h2>
      <div
        style={{
          position: "relative",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <div
          ref={centerFrameRef}
          style={{
            width: CAMERA_DIMENSIONS.width / 1.6,
            height: CAMERA_DIMENSIONS.height / 1.6,
            border: "3px solid black",
            position: "absolute",
          }}
        />
        <video
          width={CAMERA_DIMENSIONS.width}
          height={CAMERA_DIMENSIONS.height}
          ref={videoRef}
        />
      </div>
      <button
        onClick={async () => {

          const detector = detectorRef.current;
          const videoEl = videoRef.current;
          const centerFrame = centerFrameRef.current;
          if (!detector || !videoEl || !centerFrame) return;
          const poses = await getPoses(detector, videoEl);
          const isFaceIn = isFaceInBorder(
            poses,
            scanStage,
            centerFrame.getBoundingClientRect(),
            videoEl.getBoundingClientRect()
          );
          if (isFaceIn) {
            const imageCapture = imageCaptureRef.current;
            if (!imageCapture) {
              return;
            }
            const imageBlob = await imageCapture.takePhoto();
            const imageURL = URL.createObjectURL(imageBlob);
            const link = document.createElement("a");
            link.href = imageURL;
            link.download = "true";
            link.click();
            link.remove();
            URL.revokeObjectURL(imageURL);
            setScanStages((prev) => {
              if (prev === "front") {
                return "left";
              }
              if (prev === "left") {
                return "right";
              }
              if (prev === "right") {
                return "success";
              }
              return prev;
            });
          }
        }}
        style={{ marginBlock: "1rem" }}
      >
        Scan for {scanStage} Stage
      </button>
    </section>
  );
}
