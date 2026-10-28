import { Component, inject } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { ApiService, errMsg } from '../core/api.service';
import { ToastService } from '../core/toast.service';

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [FormsModule],
  template: `
    <h2>Change password</h2>
    <form #f="ngForm" class="card" (ngSubmit)="submit(f)">
      <label for="current">Current password</label>
      <input id="current" name="current" type="password" ngModel required autocomplete="current-password">
      <label for="next">New password</label>
      <input id="next" name="next" type="password" ngModel required autocomplete="new-password">
      <p class="mute">At least 10 characters, with an upper case letter, a lower case letter and a number.</p>
      <p><button class="btn" [disabled]="f.invalid">Change password</button></p>
    </form>
  `
})
export class AccountComponent {
  private api = inject(ApiService);
  private toast = inject(ToastService);

  async submit(f: NgForm) {
    try {
      await this.api.changePassword(f.value.current, f.value.next);
      this.toast.show('Password changed');
      f.resetForm();
    } catch (e) { this.toast.show(errMsg(e), true); }
  }
}
