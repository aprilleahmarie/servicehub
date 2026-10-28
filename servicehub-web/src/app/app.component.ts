import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastService } from './core/toast.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `
    <router-outlet />
    @if (toast.msg(); as m) {
      <div class="toast" [class.bad]="m.bad" role="status">{{ m.text }}</div>
    }
  `
})
export class AppComponent {
  toast = inject(ToastService);
}
