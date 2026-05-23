import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<AuthService>;

  const mockUser = { sub: 'user_1', email: 'test@example.com', role: 'USER' };

  beforeEach(async () => {
    authService = {
      register: jest.fn(),
      login: jest.fn(),
      refreshToken: jest.fn(),
      logout: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    })
      .overrideGuard(LocalAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe('register', () => {
    it('should call authService.register', async () => {
      const dto = {
        email: 'test@example.com',
        password: 'password123',
        name: 'Test',
      };
      const result = {
        id: 'user_1',
        email: 'test@example.com',
        name: 'Test',
        role: 'USER',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      authService.register.mockResolvedValue(result);

      const res = await controller.register(dto);

      expect(authService.register).toHaveBeenCalledWith(dto);
      expect(res).toEqual(result);
    });
  });

  describe('login', () => {
    it('should call authService.login with user', async () => {
      const tokens = { access_token: 'at', refresh_token: 'rt' };
      authService.login.mockResolvedValue(tokens);

      const res = await controller.login(mockUser);

      expect(authService.login).toHaveBeenCalledWith(mockUser);
      expect(res).toEqual(tokens);
    });
  });

  describe('refresh', () => {
    it('should call authService.refreshToken', async () => {
      const tokens = { access_token: 'at', refresh_token: 'rt' };
      authService.refreshToken.mockResolvedValue(tokens);

      const res = await controller.refresh({ refresh_token: 'rt_123' });

      expect(authService.refreshToken).toHaveBeenCalledWith('rt_123');
      expect(res).toEqual(tokens);
    });
  });

  describe('logout', () => {
    it('should call authService.logout with user sub', async () => {
      await controller.logout(mockUser);

      expect(authService.logout).toHaveBeenCalledWith('user_1');
    });
  });
});
