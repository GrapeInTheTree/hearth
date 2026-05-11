/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        // feature scopes
        'tickets',
        'moderation',
        'leveling',
        'roles',
        'welcome',
        'logging',
        'automod',
        'verification',
        'self-roles',
        // technical scopes
        'core',
        'config',
        'i18n',
        'db',
        'shared',
        'tsconfig',
        'eslint',
        // ops scopes
        'deps',
        'ci',
        'docker',
        'docs',
        'release',
        'infra',
      ],
    ],
    'subject-case': [2, 'never', ['pascal-case', 'upper-case']],
    'header-max-length': [2, 'always', 100],
  },
};
