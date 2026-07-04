export interface SpeechResult {
  transcript: string;
  isFinal: boolean;
}

export class SpeechManager {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private recognition: any = null;
  private isListening: boolean = false;
  private onResultCallback: ((result: SpeechResult) => void) | null = null;
  private onStateChangeCallback: ((listening: boolean) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      console.error("IntuitCode: Web Speech API not supported in this browser");
      return;
    }

    this.recognition = new SpeechRecognitionAPI();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = "en-US";

    this.recognition.onresult = (event: any) => {
      let interim = "";
      let final = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      if (final && this.onResultCallback) {
        this.onResultCallback({ transcript: final.trim(), isFinal: true });
      } else if (interim && this.onResultCallback) {
        this.onResultCallback({ transcript: interim.trim(), isFinal: false });
      }
    };

    this.recognition.onerror = (event: any) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      console.error("IntuitCode speech error:", event.error);
      this.isListening = false;
      this.onStateChangeCallback?.(false);
      this.onErrorCallback?.(event.error);
    };

    this.recognition.onend = () => {
      if (this.isListening) this.recognition.start();
    };
  }

  onResult(callback: (result: SpeechResult) => void): void {
    this.onResultCallback = callback;
  }

  onStateChange(callback: (listening: boolean) => void): void {
    this.onStateChangeCallback = callback;
  }

  onError(callback: (error: string) => void): void {
    this.onErrorCallback = callback;
  }

  start(): void {
    if (!this.recognition || this.isListening) return;
    this.isListening = true;
    this.recognition.start();
    this.onStateChangeCallback?.(true);
  }

  stop(): void {
    if (!this.recognition || !this.isListening) return;
    this.isListening = false;
    this.recognition.stop();
    this.onStateChangeCallback?.(false);
  }

  toggle(): void {
    this.isListening ? this.stop() : this.start();
  }

  get listening(): boolean {
    return this.isListening;
  }
}
