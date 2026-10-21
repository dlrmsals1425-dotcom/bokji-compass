export interface SpeechCallbacks {
  onStart: () => void;
  onProcessing?: () => void;
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}

export interface SpeechSession {
  start: () => void;
  stop: () => void;
  cancel: () => void;
}
