// Copyright 2018 The Casbin Authors. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { getLogger, logPrint } from '../log';

export type MatchingFunc = (arg1: string, arg2: string) => boolean;

// DEFAULT_DOMAIN defines the default domain space.
const DEFAULT_DOMAIN = 'casbin::default';

// loadOrDefault returns the existing value for the key if present.
// Otherwise, it stores and returns the given value.
function loadOrDefault<K, V>(map: Map<K, V>, key: K, value: V): V {
  const read = map.get(key);
  if (read === undefined) {
    map.set(key, value);
    return value;
  }
  return read;
}

/**
 * Role represents the data structure for a role in RBAC.
 */
class Role {
  public name: string;
  private roles: Role[];

  constructor(name: string) {
    this.name = name;
    this.roles = [];
  }

  public addRole(role: Role): void {
    if (this.roles.some((n) => n.name === role.name)) {
      return;
    }
    this.roles.push(role);
  }

  public deleteRole(role: Role): void {
    this.roles = this.roles.filter((n) => n.name !== role.name);
  }

  public hasRole(name: string, hierarchyLevel: number): boolean {
    if (this.name === name) {
      return true;
    }
    if (hierarchyLevel <= 0) {
      return false;
    }
    for (const role of this.roles) {
      if (role.hasRole(name, hierarchyLevel - 1)) {
        return true;
      }
    }

    return false;
  }

  public hasDirectRole(name: string): boolean {
    return this.roles.some((n) => n.name === name);
  }

  public toString(): string {
    return this.name + this.roles.join(', ');
  }

  public getRoles(): string[] {
    return this.roles.map((n) => n.name);
  }
}

class Roles extends Map<string, Role> {
  constructor() {
    super();
  }

  public hasRole(name: string, matchingFunc?: MatchingFunc): boolean {
    let ok = false;
    if (matchingFunc) {
      this.forEach((value, key) => {
        if (matchingFunc(name, key)) {
          ok = true;
        }
      });
    } else {
      return this.has(name);
    }
    return ok;
  }

  public createRole(name: string, matchingFunc?: MatchingFunc): Role {
    const role = loadOrDefault(this, name, new Role(name));
    if (matchingFunc) {
      this.forEach((value, key) => {
        if (matchingFunc(name, key) && name !== key) {
          // Add new role to matching role
          const role1 = loadOrDefault(this, key, new Role(key));
          role.addRole(role1);
        }
      });
    }
    return role;
  }
}

// RoleManager provides a default implementation for the RoleManager interface
export class internalRoleManager {
  private allDomains: Map<string, Roles>;
  private readonly maxHierarchyLevel: number;
  private hasPattern = false;
  private hasDomainPattern = false;
  private matchingFunc: MatchingFunc;
  private domainMatchingFunc: MatchingFunc;

  /**
   * InternalRoleManager is the constructor for creating an instance of the
   * default RoleManager internal implementation.
   *
   * @param maxHierarchyLevel the maximized allowed RBAC hierarchy level.
   */
  constructor(maxHierarchyLevel: number) {
    this.allDomains = new Map<string, Roles>();
    this.allDomains.set(DEFAULT_DOMAIN, new Roles());
    this.maxHierarchyLevel = maxHierarchyLevel;
  }

  /**
   * addMatchingFuncInternal support use pattern in g
   * @param name name
   * @param fn matching function
   * @deprecated
   */
  public addMatchingFuncInternal(name: string, fn: MatchingFunc): void;

  /**
   * addMatchingFunc support use pattern in g
   * @param fn matching function
   */
  public addMatchingFuncInternal(fn: MatchingFunc): void;

  /**
   * addMatchingFuncInternal support use pattern in g
   * @param name name
   * @param fn matching function
   * @deprecated
   */
  public addMatchingFuncInternal(name: string | MatchingFunc, fn?: MatchingFunc): void {
    this.hasPattern = true;
    if (typeof name === 'string' && fn) {
      this.matchingFunc = fn;
    } else if (typeof name === 'function') {
      this.matchingFunc = name;
    } else {
      throw new Error('error: domain should be 1 parameter');
    }
  }

  /**
   * addDomainMatchingFuncInternal support use domain pattern in g
   * @param fn domain matching function
   * ```
   */
  public addDomainMatchingFuncInternal(fn: MatchingFunc): void {
    this.hasDomainPattern = true;
    this.domainMatchingFunc = fn;
  }

  private generateTempRolesInternal(domain: string): Roles {
    loadOrDefault(this.allDomains, domain, new Roles());

    const patternDomain = new Set([domain]);
    if (this.hasDomainPattern) {
      this.allDomains.forEach((value, key) => {
        if (this.domainMatchingFunc(domain, key)) {
          patternDomain.add(key);
        }
      });
    }

    const allRoles = new Roles();
    patternDomain.forEach((domain) => {
      loadOrDefault(this.allDomains, domain, new Roles()).forEach((value, key) => {
        const role1 = allRoles.createRole(value.name, this.matchingFunc);
        value.getRoles().forEach((n) => {
          role1.addRole(allRoles.createRole(n, this.matchingFunc));
        });
      });
    });
    return allRoles;
  }

  /**
   * addLinkInternal adds the inheritance link between role: name1 and role: name2.
   * aka role: name1 inherits role: name2.
   * domain is a prefix to the roles.
   */
  public addLinkInternal(name1: string, name2: string, ...domain: string[]): void {
    if (domain.length === 0) {
      domain = [DEFAULT_DOMAIN];
    } else if (domain.length > 1) {
      throw new Error('error: domain should be 1 parameter');
    }

    const allRoles = loadOrDefault(this.allDomains, domain[0], new Roles());

    const role1 = loadOrDefault(allRoles, name1, new Role(name1));
    const role2 = loadOrDefault(allRoles, name2, new Role(name2));
    role1.addRole(role2);
  }

  /**
   * clearInternal clears all stored data and resets the role manager to the initial state.
   */
  public clearInternal(): void {
    this.allDomains = new Map();
    this.allDomains.set(DEFAULT_DOMAIN, new Roles());
  }

  /**
   * deleteLinkInternal deletes the inheritance link between role: name1 and role: name2.
   * aka role: name1 does not inherit role: name2 any more.
   * domain is a prefix to the roles.
   */
  public deleteLinkInternal(name1: string, name2: string, ...domain: string[]): void {
    if (domain.length === 0) {
      domain = [DEFAULT_DOMAIN];
    } else if (domain.length > 1) {
      throw new Error('error: domain should be 1 parameter');
    }

    const allRoles = loadOrDefault(this.allDomains, domain[0], new Roles());

    if (!allRoles.has(name1) || !allRoles.has(name2)) {
      return;
    }

    const role1 = loadOrDefault(allRoles, name1, new Role(name1));
    const role2 = loadOrDefault(allRoles, name2, new Role(name2));
    role1.deleteRole(role2);
  }

  /**
   * hasLinkInternal determines whether role: name1 inherits role: name2.
   * domain is a prefix to the roles.
   */
  public hasLinkInternal(name1: string, name2: string, ...domain: string[]): boolean {
    if (domain.length === 0) {
      domain = [DEFAULT_DOMAIN];
    } else if (domain.length > 1) {
      throw new Error('error: domain should be 1 parameter');
    }

    if (name1 === name2) {
      return true;
    }

    let allRoles: Roles;
    if (this.hasPattern || this.hasDomainPattern) {
      allRoles = this.generateTempRolesInternal(domain[0]);
    } else {
      allRoles = loadOrDefault(this.allDomains, domain[0], new Roles());
    }

    if (!allRoles.hasRole(name1, this.matchingFunc) || !allRoles.hasRole(name2, this.matchingFunc)) {
      return false;
    }

    const role1 = allRoles.createRole(name1, this.matchingFunc);
    return role1.hasRole(name2, this.maxHierarchyLevel);
  }

  /**
   * getRoles gets the roles that a subject inherits.
   * domain is a prefix to the roles.
   */
  public getRolesInternal(name: string, ...domain: string[]): string[] {
    if (domain.length === 0) {
      domain = [DEFAULT_DOMAIN];
    } else if (domain.length > 1) {
      throw new Error('error: domain should be 1 parameter');
    }

    let allRoles: Roles;
    if (this.hasPattern || this.hasDomainPattern) {
      allRoles = this.generateTempRolesInternal(domain[0]);
    } else {
      allRoles = loadOrDefault(this.allDomains, domain[0], new Roles());
    }

    if (!allRoles.hasRole(name, this.matchingFunc)) {
      return [];
    }

    return allRoles.createRole(name, this.matchingFunc).getRoles();
  }

  /**
   * getUsersInternal gets the users that inherits a subject.
   * domain is an unreferenced parameter here, may be used in other implementations.
   */
  public getUsersInternal(name: string, ...domain: string[]): string[] {
    if (domain.length === 0) {
      domain = [DEFAULT_DOMAIN];
    } else if (domain.length > 1) {
      throw new Error('error: domain should be 1 parameter');
    }

    let allRoles: Roles;
    if (this.hasPattern || this.hasDomainPattern) {
      allRoles = this.generateTempRolesInternal(domain[0]);
    } else {
      allRoles = loadOrDefault(this.allDomains, domain[0], new Roles());
    }

    if (!allRoles.hasRole(name, this.matchingFunc)) {
      return [];
    }

    return [...allRoles.values()].filter((n) => n.hasDirectRole(name)).map((n) => n.name);
  }

  /**
   * printRolesInternal prints all the roles to log.
   */
  public printRolesInternal(): void {
    if (getLogger().isEnable()) {
      [...this.allDomains.values()].forEach((n) => {
        logPrint(n.toString());
      });
    }
  }
}