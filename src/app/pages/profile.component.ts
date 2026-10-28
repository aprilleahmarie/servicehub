import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errMsg } from '../core/api.service';
import { Category, ProviderMe } from '../core/models';
import { ToastService } from '../core/toast.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [FormsModule],
  template: `
    <h2>My service profile</h2>
    @if (me(); as p) {
      <form #f="ngForm" class="card" (ngSubmit)="save(f.value)">
        <p>Status: <span [class]="'chip ' + p.status">{{ p.status }}</span></p>
        <label for="categoryId">Category</label>
        <select id="categoryId" name="categoryId" [ngModel]="p.categoryId">
          @for (c of cats(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }
        </select>
        <label for="description">Services offered</label>
        <textarea id="description" name="description" rows="3" [ngModel]="p.description"></textarea>
        <label for="rate">Rate</label>
        <input id="rate" name="rate" [ngModel]="p.rate" placeholder="500 per visit">
        <p><button class="btn">Save profile</button></p>
      </form>
    } @else {
      <p class="mute">Loading…</p>
    }
  `
})
export class ProfileComponent implements OnInit {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  me = signal<ProviderMe | null>(null);
  cats = signal<Category[]>([]);

  async ngOnInit() {
    try {
      this.cats.set(await this.api.categories());
      this.me.set(await this.api.providerMe());
    } catch (e) { this.toast.show(errMsg(e), true); }
  }
  async save(v: { categoryId: number; description: string | null; rate: string | null }) {
    try {
      await this.api.saveProfile({ categoryId: Number(v.categoryId), description: v.description ?? '', rate: v.rate ?? '' });
      this.toast.show('Profile saved');
    } catch (e) { this.toast.show(errMsg(e), true); }
  }
}
