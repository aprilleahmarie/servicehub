import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { ApiService, errMsg } from '../core/api.service';
import { Category } from '../core/models';
import { ToastService } from '../core/toast.service';

@Component({
  selector: 'app-admin-categories',
  standalone: true,
  imports: [FormsModule],
  template: `
    <h2>Service categories</h2>
    <form #f="ngForm" class="card filters" (ngSubmit)="add(f)">
      <input name="name" ngModel required placeholder="New category name" aria-label="New category name">
      <button class="btn" [disabled]="f.invalid">Add category</button>
    </form>
    @for (c of cats(); track c.id) {
      <div class="card row"><span>{{ c.name }}</span><button class="btn alt sm" (click)="remove(c)">Remove</button></div>
    }
  `
})
export class AdminCategoriesComponent implements OnInit {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  cats = signal<Category[]>([]);

  async ngOnInit() { await this.load(); }
  async load() {
    try { this.cats.set(await this.api.categories()); } catch (e) { this.toast.show(errMsg(e), true); }
  }
  async add(f: NgForm) {
    try { await this.api.addCategory(f.value.name); this.toast.show('Category added'); f.resetForm(); await this.load(); }
    catch (e) { this.toast.show(errMsg(e), true); }
  }
  async remove(c: Category) {
    try { await this.api.deleteCategory(c.id); this.toast.show('Category removed'); await this.load(); }
    catch (e) { this.toast.show(errMsg(e), true); }
  }
}
