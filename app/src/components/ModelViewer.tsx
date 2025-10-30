// app/src/components/ModelViewer.tsx
import React, { forwardRef } from "react";
import "@google/model-viewer";

export type ModelViewerHandle = HTMLElement;

export type ModelViewerProps = {
  src?: string;
  ar?: boolean;
  arModes?: string;
  cameraControls?: boolean;
  poster?: string;
  environmentImage?: string;
  exposure?: number;
  cameraOrbit?: string;
  fieldOfView?: string;
  toneMapping?: string;
  disableZoom?: boolean;
  autoplay?: boolean;
  shadowIntensity?: number;
  minCameraOrbit?: string;
  maxCameraOrbit?: string;
  cameraTarget?: string;
  touchAction?: string;
  reveal?: string;
  style?: React.CSSProperties;
  className?: string;
  children?: React.ReactNode;
};

const ModelViewer = forwardRef<ModelViewerHandle, ModelViewerProps>(
  ({ style, shadowIntensity, minCameraOrbit, maxCameraOrbit, environmentImage,
     cameraControls, arModes, fieldOfView, cameraOrbit, toneMapping,
     disableZoom, cameraTarget, touchAction, children, ...props }, ref) => {

    const mergedStyle: React.CSSProperties = {
      width: "100%",
      height: "70vh",
      background: "#0b0b0b",
      ...style,
    };

    const modelViewerProps: Record<string, any> = { ...props, style: mergedStyle };

    if (cameraControls) modelViewerProps["camera-controls"] = true;
    if (arModes) modelViewerProps["ar-modes"] = arModes;
    if (fieldOfView) modelViewerProps["field-of-view"] = fieldOfView;
    if (cameraOrbit) modelViewerProps["camera-orbit"] = cameraOrbit;
    if (cameraTarget) modelViewerProps["camera-target"] = cameraTarget;
    if (toneMapping) modelViewerProps["tone-mapping"] = toneMapping;
    if (disableZoom) modelViewerProps["disable-zoom"] = true;
    if (touchAction) modelViewerProps["touch-action"] = touchAction;
    if (shadowIntensity !== undefined) modelViewerProps["shadow-intensity"] = shadowIntensity;
    if (minCameraOrbit) modelViewerProps["min-camera-orbit"] = minCameraOrbit;
    if (maxCameraOrbit) modelViewerProps["max-camera-orbit"] = maxCameraOrbit;
    if (environmentImage) modelViewerProps["environment-image"] = environmentImage;

    return React.createElement("model-viewer", { ...modelViewerProps, ref } as any, children);
  }
);

ModelViewer.displayName = "ModelViewer";
export default ModelViewer;
