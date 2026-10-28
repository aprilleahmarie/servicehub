import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { errMsg } from '../core/api.service';
import { ToastService } from '../core/toast.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <header><span class="brand">Service<i>Hub</i></span></header>
    <main>
      <div class="hero">
        <div>
          <h1>Find a local provider and book a time that works.</h1>
          <p class="mute">Cleaning, plumbing, electrical, gardening, pet care and computer repair. See who is free, then send a booking request.</p>
        </div>
        <form #f="ngForm" class="card" (ngSubmit)="submit(f.value)">
          <h2>Log in</h2>
          <label for="email">Email</label>
          <input id="email" name="email" type="email" ngModel required autocomplete="username">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" ngModel required autocomplete="current-password">
          <p><button class="btn" [disabled]="busy() || f.invalid">Log in</button></p>
          <p class="mute">No account yet? <a routerLink="/register">Create one</a></p>
        </form>
      </div>
    </main>
  `
})
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  private toast = inject(ToastService);
  busy = signal(false);

  async submit(v: { email: string; password: string }) {
    this.busy.set(true);
    try {
      const u = await this.auth.login(v.email, v.password);
      await this.router.navigateByUrl(this.auth.home(u.role));
    } catch (e) {
      this.toast.show(errMsg(e), true);
    } finally {
      this.busy.set(false);
    }
  }
}
