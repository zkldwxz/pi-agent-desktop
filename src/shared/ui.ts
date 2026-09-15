/** One question the agent is asking the user, on behalf of an extension. */
export interface UiRequest {
  id: string;
  kind: "confirm" | "select" | "input";
  title: string;
  message?: string;
  /** select only */
  options?: string[];
  placeholder?: string;
  /** extension that raised it, for attribution */
  source?: string;
  createdAt: number;
}

export interface UiAnswer {
  id: string;
  /** cancelled when the user dismissed it */
  cancelled?: boolean;
  /** confirm */
  confirmed?: boolean;
  /** select / input */
  value?: string;
}

export interface UiNotification {
  id: string;
  message: string;
  type: "info" | "warning" | "error";
  at: number;
}
