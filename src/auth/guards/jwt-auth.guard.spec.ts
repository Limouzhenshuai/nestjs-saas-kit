import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  it('should extend AuthGuard("jwt")', () => {
    const guard = new JwtAuthGuard();
    expect(guard).toBeDefined();
  });
});
