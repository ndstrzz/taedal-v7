// app/src/types/model-viewer.d.ts

// Minimal runtime shape we use from model-viewer
export interface ModelViewerElement extends HTMLElement {
  /** Lit's updateComplete promise */
  updateComplete?: Promise<unknown>;
  /** glTF scene + materials (shape kept loose on purpose) */
  model?: any;
  /** create a texture from URL */
  createTexture?: (url: string) => Promise<any>;
}

// Allow <model-viewer> in JSX
declare global {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<
        React.HTMLAttributes<ModelViewerElement>,
        ModelViewerElement
      > & {
        src?: string;
        ar?: boolean;
        "ar-modes"?: string;
        "camera-controls"?: boolean;
        exposure?: string | number;
        "environment-image"?: string;
        // You can add more attributes as you need them
      };
    }
  }
}

// If someone imports it (not required when using CDN), don’t error.
declare module "@google/model-viewer" {
  export {};
}
