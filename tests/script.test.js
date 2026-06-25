import { jest } from '@jest/globals';
import { ldaptsMock } from '@sgnl-actions/testing/ldap-scenarios';

jest.unstable_mockModule('ldapts', ldaptsMock);

const { runLDAPScenarios } = await import('@sgnl-actions/testing/ldap-scenarios');

runLDAPScenarios({
  script: './src/script.mjs',
  scenarios: './tests/scenarios.yaml'
});
