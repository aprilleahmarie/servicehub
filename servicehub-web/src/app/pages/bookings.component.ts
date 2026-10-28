import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errMsg } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { Booking, SLOTS } from '../core/models';
import { ToastService } from '../core/toast.service';

/** One screen for three roles: customer (My bookings), provider (Requests), admin (All bookings). */
@Component({
  selector: 'app-bookings',
  standalone: true,
  imports: [FormsModule],
  template: `
    <h2>{{ title() }}</h2>
    @if (role() === 'provider' && providerStatus() && providerStatus() !== 'Active') {
      <div class="card">Your account is {{ providerStatus() }}. Customers can find you once an administrator approves it.</div>
    }
    @for (b of list(); track b.id) {
      <div class="card">
        <div class="row">
          <div>
            <h3>
              @if (role() === 'customer') { {{ b.provider_name }} <span class="mute">· {{ b.category }}</span> }
              @else if (role() === 'provider') { {{ b.customer_name }} }
              @else { {{ b.customer_name }} → {{ b.provider_name }} }
            </h3>
            <div class="mute">{{ b.date }} · {{ SL[b.slot] }}@if (b.note) { · {{ b.note }} }</div>
            @if (b.customer_contact) { <div class="mute">Contact: {{ b.customer_contact }} · {{ b.customer_address }}</div> }
            @if (role() === 'customer' && b.provider_contact) { <div class="mute">Contact: {{ b.provider_contact }}</div> }
          </div>
          <span [class]="'chip ' + b.status">{{ b.status }}</span>
        </div>
        <div class="acts">
          @if (role() === 'customer') {
            @if (b.status === 'Pending') { <button class="btn bad sm" (click)="setStatus(b, 'Cancelled')">Cancel booking</button> }
            @if (b.status === 'Completed' && !b.reviewed) { <button class="btn sm" (click)="reviewing.set(b)">Rate and review</button> }
          }
          @if (role() === 'provider') {
            @if (b.status === 'Pending') {
              <button class="btn sm" (click)="setStatus(b, 'Accepted')">Accept</button>
              <button class="btn bad sm" (click)="setStatus(b, 'Rejected')">Reject</button>
            }
            @if (b.status === 'Accepted') { <button class="btn sm" (click)="setStatus(b, 'Completed')">Mark completed</button> }
          }
        </div>
      </div>
    } @empty {
      <p class="mute">{{ loading() ? 'Loading…' : 'Nothing here yet.' }}</p>
    }

    @if (reviewing(); as b) {
      <div class="ov" role="dialog" aria-modal="true">
        <div class="card">
          <h2>Rate {{ b.provider_name }}</h2>
          <form #f="ngForm" (ngSubmit)="sendReview(b, f.value)">
            <label for="rating">Rating</label>
            <select id="rating" name="rating" [ngModel]="5">
              @for (n of [5, 4, 3, 2, 1]; track n) { <option [ngValue]="n">{{ n }} out of 5</option> }
            </select>
            <label for="text">Your review</label>
            <textarea id="text" name="text" rows="3" ngModel required></textarea>
            <div class="row mt">
              <button type="button" class="btn alt" (click)="reviewing.set(null)">Close</button>
              <button class="btn" [disabled]="f.invalid">Submit review</button>
            </div>
          </form>
        </div>
      </div>
    }
  `
})
export class BookingsComponent implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  SL = SLOTS;
  list = signal<Booking[]>([]);
  loading = signal(true);
  providerStatus = signal<string | null>(null);
  reviewing = signal<Booking | null>(null);
  role = computed(() => this.auth.user()?.role);
  title = computed(() => this.role() === 'customer' ? 'My bookings' : this.role() === 'provider' ? 'Booking requests and history' : 'All bookings');

  async ngOnInit() {
    await this.load();
    if (this.role() === 'provider') {
      try { this.providerStatus.set((await this.api.providerMe()).status); } catch { /* not important */ }
    }
  }
  async load() {
    try { this.list.set(await this.api.bookings()); }
    catch (e) { this.toast.show(errMsg(e), true); }
    finally { this.loading.set(false); }
  }
  async setStatus(b: Booking, status: string) {
    try { await this.api.setStatus(b.id, status); this.toast.show('Booking updated'); await this.load(); }
    catch (e) { this.toast.show(errMsg(e), true); }
  }
  async sendReview(b: Booking, v: { rating: number; text: string }) {
    try {
      await this.api.review(b.id, Number(v.rating), v.text);
      this.reviewing.set(null);
      this.toast.show('Review submitted');
      await this.load();
    } catch (e) { this.toast.show(errMsg(e), true); }
  }
}
