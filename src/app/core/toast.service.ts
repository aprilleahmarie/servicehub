import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly msg = signal<{ text: string; bad: boolean } | null>(null);
  private timer: ReturnType<typeof setTimeout> | undefined;

  show(text: string, bad = false) {
    this.msg.set({ text, bad });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.msg.set(null), 4000);
  }
}
