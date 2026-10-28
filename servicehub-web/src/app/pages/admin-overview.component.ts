import { Component, inject, OnInit, signal } from '@angular/core';
import { ApiService, errMsg } from '../core/api.service';
import { Stats } from '../core/models';
import { ToastService } from '../core/toast.service';

@Component({
  selector: 'app-admin-overview',
  standalone: true,
  template: `
    <h2>Overview</h2>
    @if (stats(); as s) {
      <div class="stats">
        <div class="card"><b>{{ s.customers }}</b>Customers</div>
        <div class="card"><b>{{ s.providers }}</b>Providers</div>
        @for (x of s.bookingsByStatus; track x.status) { <div class="card"><b>{{ x.n }}</b>{{ x.status }}</div> }
      </div>
    } @else {
      <p class="mute">Loading…</p>
    }
    <button class="btn" (click)="backup()">Create backup now</button>
  `
})
export class AdminOverviewComponent implements OnInit {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  stats = signal<Stats | null>(null);

  async ngOnInit() {
    try { this.stats.set(await this.api.stats()); } catch (e) { this.toast.show(errMsg(e), true); }
  }
  async backup() {
    try { const r = await this.api.backup(); this.toast.show('Backup saved: ' + r.file); }
    catch (e) { this.toast.show(errMsg(e), true); }
  }
}
