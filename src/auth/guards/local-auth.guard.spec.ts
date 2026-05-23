import { LocalAuthGuard } from './local-auth.guard';

describe('LocalAuthGuard', () => {
  it('should extend AuthGuard("local")', () => {
    const guard = new LocalAuthGuard();
    expect(guard).toBeDefined();
  });
});
