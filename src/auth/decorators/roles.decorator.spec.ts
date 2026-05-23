import { ROLES_KEY, Roles } from './roles.decorator';

describe('Roles Decorator', () => {
  it('should set metadata with the given roles', () => {
    @Roles('ADMIN', 'CREATOR')
    class TestController {}

    const roles = Reflect.getOwnMetadata(ROLES_KEY, TestController);
    expect(roles).toEqual(['ADMIN', 'CREATOR']);
  });

  it('should set empty array when no roles provided', () => {
    @Roles()
    class TestController {}

    const roles = Reflect.getOwnMetadata(ROLES_KEY, TestController);
    expect(roles).toEqual([]);
  });

  it('should set metadata on class when used as class decorator', () => {
    @Roles('USER')
    class TestController {}

    const roles = Reflect.getOwnMetadata(ROLES_KEY, TestController);
    expect(roles).toEqual(['USER']);
  });
});
