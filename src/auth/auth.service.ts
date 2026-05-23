import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';

const SALT_ROUNDS = 12;

function hashToken(token: string): Promise<string> {
  const sha256 = createHash('sha256').update(token).digest('hex');
  return bcrypt.hash(sha256, SALT_ROUNDS);
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        name: dto.name,
      },
    });

    return this.sanitizeUser(user);
  }

  async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      return null;
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return null;
    }
    return this.sanitizeUser(user);
  }

  async login(user: {
    id?: string;
    sub?: string;
    email: string;
    role: string;
  }) {
    const userId = user.sub ?? user.id!;
    const payload = { sub: userId, email: user.email, role: user.role };
    const access_token = this.jwtService.sign(payload);

    const refresh_token = this.jwtService.sign(
      { ...payload, jti: randomUUID() },
      { expiresIn: '7d' },
    );
    const refreshTokenHash = await hashToken(refresh_token);

    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash },
    });

    return { access_token, refresh_token };
  }

  async refreshToken(token: string) {
    let payload: { sub: string; email: string; role: string };
    try {
      payload = this.jwtService.verify(token, {
        ignoreExpiration: true,
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || !user.refreshTokenHash) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const valid = await bcrypt.compare(tokenHash, user.refreshTokenHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.login({ sub: user.id, email: user.email, role: user.role });
  }

  async logout(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash: null },
    });
  }

  private sanitizeUser(user: {
    id: string;
    email: string;
    name: string | null;
    role: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    passwordHash?: string;
    refreshTokenHash?: string | null;
  }) {
    const { passwordHash, refreshTokenHash, ...safe } = user;
    return safe;
  }
}
