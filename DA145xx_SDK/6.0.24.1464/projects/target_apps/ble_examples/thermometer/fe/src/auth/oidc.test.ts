import { describe, expect, it } from 'vitest';
import type { User } from 'oidc-client-ts';
import { primaryRole, roleOf } from './oidc';

function fakeUser(roles: string[]): User {
  return { profile: { sub: 'user-1', realm_access: { roles } } } as unknown as User;
}

describe('primaryRole', () => {
  it('picks admin over doctor and customer when a user has multiple roles', () => {
    expect(primaryRole(['customer', 'doctor', 'admin'])).toBe('admin');
  });

  it('picks doctor over customer', () => {
    expect(primaryRole(['customer', 'doctor'])).toBe('doctor');
  });

  it('returns null for a realm role this app does not know about', () => {
    expect(primaryRole(['offline_access', 'uma_authorization'])).toBeNull();
  });

  it('returns null for no roles', () => {
    expect(primaryRole([])).toBeNull();
  });
});

describe('roleOf', () => {
  it('derives the role from a user’s realm_access claim', () => {
    expect(roleOf(fakeUser(['customer']))).toBe('customer');
  });

  it('returns null for a null/undefined user (not signed in)', () => {
    expect(roleOf(null)).toBeNull();
    expect(roleOf(undefined)).toBeNull();
  });
});
