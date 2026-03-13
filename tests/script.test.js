import { jest } from '@jest/globals';

// Mock ldapts module BEFORE importing runLDAPScenarios
jest.unstable_mockModule('ldapts', () => ({
  Client: jest.fn(),
  Change: jest.fn(),
  Attribute: jest.fn()
}));

// Now import and run
const { runLDAPScenarios } = await import('@sgnl-actions/testing/ldap-scenarios');

runLDAPScenarios({
  script: './src/script.mjs',
  scenarios: './tests/scenarios.yaml'
});
