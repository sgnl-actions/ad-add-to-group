#!/usr/bin/env node

/**
 * Simple metadata validation script
 */

import fs from 'fs';
import yaml from 'js-yaml';

const METADATA_FILE = 'metadata.yaml';

function validateMetadata() {
  try {
    // Check if metadata file exists
    if (!fs.existsSync(METADATA_FILE)) {
      console.error('❌ metadata.yaml file not found');
      process.exit(1);
    }

    // Parse YAML
    const content = fs.readFileSync(METADATA_FILE, 'utf8');
    const metadata = yaml.load(content);

    // Basic validation
    const errors = [];

    if (!metadata.name) {
      errors.push('Missing required field: name');
    }

    if (!metadata.description) {
      errors.push('Missing required field: description');
    }

    if (!metadata.inputs || typeof metadata.inputs !== 'object') {
      errors.push('Missing or invalid inputs section');
    } else {
      // Validate each input
      for (const [inputName, inputDef] of Object.entries(metadata.inputs)) {
        if (!inputDef.type) {
          errors.push(`Input '${inputName}' missing type`);
        }
        if (!inputDef.description) {
          errors.push(`Input '${inputName}' missing description`);
        }
        if (typeof inputDef.required !== 'boolean') {
          errors.push(`Input '${inputName}' missing or invalid required field`);
        }
      }
    }

    if (!metadata.outputs || typeof metadata.outputs !== 'object') {
      errors.push('Missing or invalid outputs section');
    } else {
      // Validate each output
      for (const [outputName, outputDef] of Object.entries(metadata.outputs)) {
        if (!outputDef.type) {
          errors.push(`Output '${outputName}' missing type`);
        }
        if (!outputDef.description) {
          errors.push(`Output '${outputName}' missing description`);
        }
      }
    }

    if (errors.length > 0) {
      console.error('❌ Metadata validation failed:');
      errors.forEach(error => console.error(`  - ${error}`));
      process.exit(1);
    }

    console.log('✅ Metadata validation passed!');
    console.log(`📝 Job: ${metadata.name}`);
    console.log(`📋 Description: ${metadata.description}`);
    console.log(`📥 Inputs: ${Object.keys(metadata.inputs).length}`);
    console.log(`📤 Outputs: ${Object.keys(metadata.outputs).length}`);

  } catch (error) {
    console.error('❌ Error validating metadata:', error.message);
    process.exit(1);
  }
}

validateMetadata();