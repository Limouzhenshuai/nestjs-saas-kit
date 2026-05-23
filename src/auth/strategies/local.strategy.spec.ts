import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { LocalStrategy } from './local.strategy';
import { AuthService } from '../auth.service';

describe('LocalStrategy', () => {
  let strategy: LocalStrategy;
  let authService: jest.Mocked<AuthService>;

  beforeEach(async () => {
    authService = { validateUser: jest.fn() } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocalStrategy,
        { provide: AuthService, useValue: authService },
      ],
    }).compile();

    strategy = module.get<LocalStrategy>(LocalStrategy);
  });

  it('should return user when credentials are valid', async () => {
    const mockUser = { id: 'user_1', email: 'test@example.com' };
    authService.validateUser.mockResolvedValue(mockUser as any);

    const result = await strategy.validate('test@example.com', 'password');

    expect(authService.validateUser).toHaveBeenCalledWith('test@example.com', 'password');
    expect(result).toEqual(mockUser);
  });

  it('should throw UnauthorizedException when credentials are invalid', async () => {
    authService.validateUser.mockResolvedValue(null);

    await expect(
      strategy.validate('test@example.com', 'wrong'),
    ).rejects.toThrow(UnauthorizedException);
  });
});
