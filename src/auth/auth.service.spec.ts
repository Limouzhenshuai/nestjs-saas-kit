import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  role: 'USER' as const,
  isActive: true,
  passwordHash: 'hashed-password',
  refreshTokenHash: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const sanitizedUser = {
  id: mockUser.id,
  email: mockUser.email,
  name: mockUser.name,
  role: mockUser.role,
  isActive: mockUser.isActive,
  createdAt: mockUser.createdAt,
  updatedAt: mockUser.updatedAt,
};

function createMockPrisma() {
  return {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let jwtService: jest.Mocked<JwtService>;

  beforeEach(async () => {
    const mockPrisma = createMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: JwtService,
          useValue: { sign: jest.fn(), verify: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = mockPrisma;
    jwtService = module.get(JwtService) as jest.Mocked<JwtService>;

    jest.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // register
  // -----------------------------------------------------------------------
  describe('register', () => {
    const dto = { email: 'test@example.com', password: 'StrongPass1', name: 'Test User' };

    it('should register a new user and return sanitized user data', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
      prisma.user.create.mockResolvedValue(mockUser);

      const result = await service.register(dto);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: dto.email },
      });
      expect(bcrypt.hash).toHaveBeenCalledWith(dto.password, 12);
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { email: dto.email, passwordHash: 'hashed-password', name: dto.name },
      });
      expect(result).toEqual(sanitizedUser);
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('refreshTokenHash');
    });

    it('should throw ConflictException when email already exists', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(service.register(dto)).rejects.toThrow(ConflictException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // validateUser
  // -----------------------------------------------------------------------
  describe('validateUser', () => {
    it('should return null when user is not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.validateUser('test@example.com', 'password');
      expect(result).toBeNull();
    });

    it('should return null when password is incorrect', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const result = await service.validateUser('test@example.com', 'wrong-password');
      expect(result).toBeNull();
    });

    it('should return sanitized user on valid credentials', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser('test@example.com', 'correct-password');
      expect(result).toEqual(sanitizedUser);
      expect(result).not.toHaveProperty('passwordHash');
    });
  });

  // -----------------------------------------------------------------------
  // login
  // -----------------------------------------------------------------------
  describe('login', () => {
    beforeEach(() => {
      jwtService.sign.mockReturnValue('mock-token');
      (bcrypt.hash as jest.Mock).mockResolvedValue('refresh-hash');
      prisma.user.update.mockResolvedValue(mockUser);
    });

    it('should generate tokens and store refresh token hash when called with id', async () => {
      const result = await service.login({
        id: 'user-1',
        email: 'test@example.com',
        role: 'USER',
      });

      expect(jwtService.sign).toHaveBeenCalledTimes(2);
      expect(result).toHaveProperty('access_token', 'mock-token');
      expect(result).toHaveProperty('refresh_token', 'mock-token');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { refreshTokenHash: 'refresh-hash' },
      });
    });

    it('should handle sub field (from JWT payload) and call prisma update', async () => {
      const result = await service.login({
        sub: 'user-1',
        email: 'test@example.com',
        role: 'ADMIN',
      });

      expect(jwtService.sign).toHaveBeenCalledTimes(2);
      expect(result).toHaveProperty('access_token');
      expect(result).toHaveProperty('refresh_token');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { refreshTokenHash: 'refresh-hash' },
      });
      // Verify the payload signed includes the role from the input
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'ADMIN' }),
        expect.anything(),
      );
    });
  });

  // -----------------------------------------------------------------------
  // refreshToken
  // -----------------------------------------------------------------------
  describe('refreshToken', () => {
    const token = 'valid-refresh-token';
    const payload = { sub: 'user-1', email: 'test@example.com', role: 'USER' };
    const userWithHash = { ...mockUser, refreshTokenHash: 'stored-hash' };

    it('should throw UnauthorizedException when JWT is invalid', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt malformed');
      });

      await expect(service.refreshToken(token)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when user is not found', async () => {
      jwtService.verify.mockReturnValue(payload);
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.refreshToken(token)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when user has no refreshTokenHash', async () => {
      jwtService.verify.mockReturnValue(payload);
      prisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(service.refreshToken(token)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when token does not match stored hash', async () => {
      jwtService.verify.mockReturnValue(payload);
      prisma.user.findUnique.mockResolvedValue(userWithHash);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.refreshToken(token)).rejects.toThrow(UnauthorizedException);
    });

    it('should return new token pair on successful refresh', async () => {
      jwtService.verify.mockReturnValue(payload);
      prisma.user.findUnique.mockResolvedValue(userWithHash);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      jwtService.sign.mockReturnValue('new-token');
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hash');
      prisma.user.update.mockResolvedValue(userWithHash);

      const result = await service.refreshToken(token);

      expect(jwtService.verify).toHaveBeenCalledWith(token, { ignoreExpiration: true });
      expect(bcrypt.compare).toHaveBeenCalledWith(
        createHash('sha256').update(token).digest('hex'),
        'stored-hash',
      );
      expect(result).toHaveProperty('access_token', 'new-token');
      expect(result).toHaveProperty('refresh_token', 'new-token');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { refreshTokenHash: 'new-hash' },
      });
    });
  });

  // -----------------------------------------------------------------------
  // logout
  // -----------------------------------------------------------------------
  describe('logout', () => {
    it('should clear refreshTokenHash for the user', async () => {
      prisma.user.update.mockResolvedValue(mockUser);

      await service.logout('user-1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { refreshTokenHash: null },
      });
    });
  });
});
