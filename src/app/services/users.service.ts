// src/app/services/users.service.ts
import { Injectable } from '@angular/core';
import PocketBase, { RecordModel } from 'pocketbase';

export interface UserRow {
  id: string;
  created: string; // ISO
  name: string;
  email?: string;
  type?: string;
  phone?: string;
  avatarUrl?: string;
  status?: 'active' | 'inactive';
}

@Injectable({ providedIn: 'root' })
export class UsersService {
  private pb = new PocketBase('https://db.buckapi.com:8090'); // tu URL PB
// Actualiza el campo "status" del usuario (true = aprobado, false = denegado)
async updateUserStatus(userId: string, approved: boolean) {
  // En tu schema "status" es un campo (boolean/select). Aquí lo tratamos como boolean.
  return await this.pb.collection('users').update(userId, { status: approved });
}

  async adminAuth(email: string, password: string) {
    await this.pb.admins.authWithPassword(email, password);
  }

  private getAvatarUrl(r: RecordModel, fileName?: string, size = '100x100') {
    if (!fileName) return 'assets/img/placeholder-user.png';
    try { return this.pb.files.getUrl(r, fileName, { thumb: size }); }
    catch { return 'assets/img/placeholder-user.png'; }
  }

  /** Método genérico para listar usuarios por uno o más tipos */
  async listUsersByType(
    types: Array<string>,                // p.ej. ['client','cliente'] o ['provider','proveedor']
    page = 1,
    perPage = 10,
    search = ''
  ): Promise<{ items: UserRow[]; page: number; perPage: number; totalItems: number; totalPages: number; }> {

    const typeFilter = '(' + types.map(t => `type = "${t}"`).join(' || ') + ')';
    const extraSearch = search
      ? ` && (name ~ "${search}" || username ~ "${search}" || email ~ "${search}")`
      : '';

    const res = await this.pb.collection('users').getList(page, perPage, {
      filter: typeFilter + extraSearch,
      sort: '-created',
      fields: 'id,created,name,username,email,emailVisibility,phone,avatar,status,type'
    });

    const items: UserRow[] = res.items.map((r: any) => {
      const email = r.emailVisibility ? r.email : undefined;
      return {
        id: r.id,
        created: r.created,
        name: r.name ?? r.username ?? '(sin nombre)',
        email,
        phone: r.phone || '',
        avatarUrl: this.getAvatarUrl(r, r.avatar),
        status: (r.status === true || r.status === 'active') ? 'active' : 'inactive',
        type: r.type,
      };
    });

    return {
      items,
      page: res.page,
      perPage: res.perPage,
      totalItems: res.totalItems,
      totalPages: res.totalPages,
    };
  }

  /** Alias específico para CLIENTES (cubre español/inglés) */
  listClients(page = 1, perPage = 10, search = '') {
    return this.listUsersByType(['client', 'cliente'], page, perPage, search);
  }

  /** Alias específico para PROVEEDORES (cubre español/inglés) */
  listProviders(page = 1, perPage = 10, search = '') {
    return this.listUsersByType(['provider', 'proveedor'], page, perPage, search);
  }
}
