import { Test, TestingModule } from '@nestjs/testing';
import {
  Controller,
  Get,
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
} from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { CurrentUser } from './current-user.decorator';

describe('CurrentUser Decorator', () => {
  let app: INestApplication<App>;
  let setUser: any;

  @Controller('test')
  class TestController {
    @Get('user')
    getUser(@CurrentUser() user: any) {
      return user;
    }

    @Get('email')
    getEmail(@CurrentUser('email') email: string) {
      return { email };
    }
  }

  @Module({
    controllers: [TestController],
  })
  class TestModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
      consumer
        .apply((req: any, _res: any, next: () => void) => {
          Object.assign(req, setUser);
          next();
        })
        .forRoutes('*');
    }
  }

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [TestModule],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should return the full user object when no data arg', () => {
    setUser = {
      user: { sub: 'user_1', email: 'test@example.com', role: 'USER' },
    };
    return request(app.getHttpServer())
      .get('/test/user')
      .expect(200)
      .expect({ sub: 'user_1', email: 'test@example.com', role: 'USER' });
  });

  it('should return a specific field when data arg is provided', () => {
    setUser = { user: { email: 'test@example.com' } };
    return request(app.getHttpServer())
      .get('/test/email')
      .expect(200)
      .expect({ email: 'test@example.com' });
  });

  it('should return empty body when requesting non-existent field', () => {
    setUser = { user: { name: 'Test' } };
    return request(app.getHttpServer())
      .get('/test/email')
      .expect(200)
      .expect({});
  });

  it('should return undefined when user is not on request', () => {
    setUser = {};
    return request(app.getHttpServer())
      .get('/test/user')
      .expect(200)
      .expect({});
  });
});
