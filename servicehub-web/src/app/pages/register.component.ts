import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService, errMsg } from '../core/api.service';
import { Category } from '../core/models';
import { ToastService } from '../core/toast.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <header><span class="brand">Service<i>Hub</i></span></header>
    <main>
      <form #f="ngForm" class="card" (ngSubmit)="submit(f.value)">
        <h2>Create an account</h2>
        <label for="name">Full name</label>
        <input id="name" name="name" ngModel required>
        <label for="role">I am a</label>
        <select id="role" name="role" ngModel="customer">
          <option value="customer">Customer</option>
          <option value="provider">Service provider</option>
        </select>
        @if (f.value.role === 'provider') {
          <label for="categoryId">Service category</label>
          <select id="categoryId" name="categoryId" [ngModel]="null" required>
            @for (c of cats(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }
          </select>
        }
        <label for="email">Email</label>
        <input id="email" name="email" type="email" ngModel required autocomplete="username">
        <label for="password">Password</label>
        <input id="password" name="password" type="password" ngModel required autocomplete="new-password">
        <p class="mute">At least 10 characters, with an upper case letter, a lower case letter and a number.</p>
        <label for="contact">Contact number</label>
        <input id="contact" name="contact" ngModel required>
        <label for="address">Address</label>
        <input id="address" name="address" ngModel>
        <p><button class="btn" [disabled]="busy() || f.invalid">Create account</button></p>
        <p class="mute">Already registered? <a routerLink="/login">Log in</a></p>
      </form>
    </main>
  `
})
export class RegisterComponent implements OnInit {
  private api = inject(ApiService);
  private router = inject(Router);
  private toast = inject(ToastService);
  cats = signal<Category[]>([]);
  busy = signal(false);

  async ngOnInit() {
    try { this.cats.set(await this.api.categories()); } catch (e) { this.toast.show(errMsg(e), true); }
  }

  async submit(v: { name: string; role: string; categoryId: number | null; email: string; password: string; contact: string; address: string | null }) {
    this.busy.set(true);
    try {
      const body = {
        role: v.role, name: v.name, email: v.email, password: v.password, contact: v.contact,
        address: v.address ?? '',
        categoryId: v.role === 'provider' ? v.categoryId : undefined
      };
      const r = await this.api.register(body);
      this.toast.show(r.message);
      await this.router.navigateByUrl('/login');
    } catch (e) {
      this.toast.show(errMsg(e), true);
    } finally {
      this.busy.set(false);
    }
  }
}
