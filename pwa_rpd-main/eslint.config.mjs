import next from 'eslint-config-next';

export default [
  ...next,
  {
    files: ['src/**/*.{ts,tsx}', 'next.config.ts'],
    rules: {
      'import/no-unresolved': 'error',
      'import/named': 'error',
      'import/default': 'error',
      'import/namespace': 'error',
      'import/no-absolute-path': 'error',
      'import/no-dynamic-require': 'error',
      'import/no-self-import': 'error',
      // Check application cycles without building an SCC graph of Next's entire
      // dependency tree (the plugin's SCC prepass ignores ignoreExternal).
      'import/no-cycle': ['error', { ignoreExternal: true, disableScc: true }],
      'import/no-useless-path-segments': 'error',
    },
  },
];
