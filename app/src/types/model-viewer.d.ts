// app/src/types/model-viewer.d.ts
import React from "react";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        src?: string;
        ar?: boolean;
        "ar-modes"?: string;
        "camera-controls"?: boolean;
        poster?: string;
        "environment-image"?: string;
        exposure?: number;
        "field-of-view"?: string;
        "camera-orbit"?: string;
        "camera-target"?: string;
        "min-camera-orbit"?: string;
        "max-camera-orbit"?: string;
        "tone-mapping"?: string;
        reveal?: string;
        "shadow-intensity"?: number;
        "disable-zoom"?: boolean;
        "touch-action"?: string;
        autoplay?: boolean;
        slot?: string;
        "data-position"?: string;
        "data-visibility-attribute"?: string;
        style?: React.CSSProperties;
        ref?: React.Ref<HTMLElement>;
      };
    }
  }
}

export {};