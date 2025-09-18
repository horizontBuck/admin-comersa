import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UsersService, UserRow } from '../../services/users.service';
import Swal from 'sweetalert2';
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './home.html',
  styleUrls: ['./home.scss']
})
export class Home {
  option = 'dashboard';

  loading = signal(false);

  // Listas
  clients   = signal<UserRow[]>([]);
  providers = signal<UserRow[]>([]);

  // Paginación / búsqueda (compartida para la vista activa)
  page       = signal(1);
  perPage    = signal(10);
  totalPages = signal(1);
  totalItems = signal(0);
  search     = signal('');

  constructor(private usersSvc: UsersService) {}
  async confirmProviderDecision(p: UserRow) {
    const result = await Swal.fire({
      title: 'Revisión de proveedor',
      html: `<div style="text-align:left">
              <b>Nombre:</b> ${p.name || '(sin nombre)'}<br>
              <b>Email:</b> ${p.email || '(oculto)'}<br>
              <b>Teléfono:</b> ${p.phone || '—'}
            </div>`,
      icon: 'question',
      showDenyButton: true,
      showCancelButton: true,
      confirmButtonText: 'Aprobar',
      denyButtonText: 'Denegar',
      cancelButtonText: 'Cancelar',
      reverseButtons: true,
    });
  
    if (!result.isConfirmed && !result.isDenied) return;
  
    const approve = result.isConfirmed;
  
    this.loading.set(true);
    try {
      await this.usersSvc.updateUserStatus(p.id, approve);
  
      const updated: UserRow[] = this.providers().map(u =>
        u.id === p.id
          ? { ...u, status: (approve ? 'active' : 'inactive') as 'active' | 'inactive' }
          : u
      );
      this.providers.set(updated);
  
      await Swal.fire({
        icon: 'success',
        title: approve ? 'Proveedor aprobado' : 'Proveedor denegado',
        timer: 1400,
        showConfirmButton: false
      });
    } catch (e) {
      await Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo actualizar.' });
    } finally {
      this.loading.set(false);
    }
  }
  
  async ngOnInit() {
    // Si arrancas en "dashboard" no carga nada.
    // Cambia a 'clientes' por defecto si quieres:
    // this.setOption('clientes');
  }

  setOption(option: string) {
    this.option = option;
    this.page.set(1);
    this.loadData(); // carga según la pestaña
  }

  async loadData() {
    this.loading.set(true);
    try {
      if (this.option === 'proveedores') {
        const res = await this.usersSvc.listProviders(this.page(), this.perPage(), this.search());
        this.providers.set(res.items);
        this.totalPages.set(res.totalPages);
        this.totalItems.set(res.totalItems);
      } else if (this.option === 'clientes') {
        const res = await this.usersSvc.listClients(this.page(), this.perPage(), this.search());
        this.clients.set(res.items);
        this.totalPages.set(res.totalPages);
        this.totalItems.set(res.totalItems);
      }
      // en 'dashboard' y otras opciones no cargamos listas
    } finally {
      this.loading.set(false);
    }
  }

  async onSearch(term: string) {
    this.search.set(term.trim());
    this.page.set(1);
    await this.loadData();
  }

  async goToPage(p: number) {
    if (p < 1 || p > this.totalPages()) return;
    this.page.set(p);
    await this.loadData();
  }

  // Bootstrap 5: usa bg-success / bg-warning
  statusBadgeClass(u: UserRow) {
    return u.status === 'active' ? 'badge bg-success' : 'badge bg-warning';
  }

  // trackBy estable por id
  trackById(_idx: number, u: UserRow) {
    return u.id;
  }

  // fallback de imagen
  onImgError(event: Event) {
    (event.target as HTMLImageElement).src = 'assets/img/placeholder-user.png';
  }
}
