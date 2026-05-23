import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('test-secret') },
        },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
  });

  describe('validate', () => {
    it('should return user object from payload', async () => {
      const result = await strategy.validate({
        sub: 'user_1',
        email: 'test@example.com',
        role: 'USER',
      });

      expect(result).toEqual({
        sub: 'user_1',
        email: 'test@example.com',
        role: 'USER',
      });
    });
  });
});
