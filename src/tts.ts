export class TTSManager {
  private synth: SpeechSynthesis;
  private voice: SpeechSynthesisVoice | null = null;
  private enabled: boolean = true;

  constructor() {
    this.synth = window.speechSynthesis;
    this.loadVoice();

    // Voices load async in Chrome
    window.speechSynthesis.onvoiceschanged = () => {
      this.loadVoice();
    };
  }

  private loadVoice(): void {
    const voices = this.synth.getVoices();

    // Prefer a natural English voice
    this.voice =
      voices.find((v) => v.name.includes("Google UK English Male")) ||
      voices.find((v) => v.name.includes("Google US English")) ||
      voices.find((v) => v.lang === "en-US" && !v.localService) ||
      voices.find((v) => v.lang.startsWith("en")) ||
      null;
  }

  speak(text: string): void {
    if (!this.enabled) return;
    this.synth.cancel();

    // Strip markdown symbols before speaking
    const clean = text
      .replace(/\*\*/g, "")
      .replace(/\*/g, "")
      .replace(/`/g, "")
      .replace(/#+\s/g, "")
      .replace(/💻/g, "")
      .trim();

    const utterance = new SpeechSynthesisUtterance(clean);
    if (this.voice) utterance.voice = this.voice;
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    this.synth.speak(utterance);
  }

  stop(): void {
    this.synth.cancel();
  }

  toggle(): void {
    this.enabled = !this.enabled;
    if (!this.enabled) this.stop();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }
}
