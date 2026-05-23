import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: jest.Mocked<Reflector>;

  function mockContext(role?: string) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user: { role } }),
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as any;
  }

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() } as any;
    guard = new RolesGuard(reflector);
  });

  it('should allow access when no roles are required', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    const result = guard.canActivate(mockContext('USER'));

    expect(result).toBe(true);
  });

  it('should allow access when user has required role', () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN']);

    const result = guard.canActivate(mockContext('ADMIN'));

    expect(result).toBe(true);
  });

  it('should throw ForbiddenException when user lacks required role', () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN']);

    expect(() => guard.canActivate(mockContext('USER'))).toThrow(ForbiddenException);
  });
});
