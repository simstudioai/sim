# Publishing Sim Studio CLI

This guide explains how to publish new versions of the Sim Studio CLI package to npm.

## Prerequisites

1. An npm account with access to the `simstudio` package
2. Node.js and npm installed
3. Git repository access

## Publishing Steps

1. **Update Version**
   - Open `package.json`
   - Update the `version` field following [semantic versioning](https://semver.org/):
     - `MAJOR`: Breaking changes
     - `MINOR`: New features (backwards compatible)
     - `PATCH`: Bug fixes (backwards compatible)

2. **Build the Package**
   ```bash
   npm run build
   ```
   This will compile TypeScript files to JavaScript in the `dist` directory.

3. **Test Locally**
   ```bash
   # Test the CLI locally
   node dist/index.js start
   ```
   Make sure everything works as expected before publishing.

4. **Login to npm** (if not already logged in)
   ```bash
   npm login
   ```

5. **Publish**
   ```bash
   npm publish
   ```

## Common Issues and Solutions

1. **Version Already Exists**
   - Make sure you've updated the version number in `package.json`
   - Each version must be unique

2. **Build Errors**
   - Check TypeScript compilation errors
   - Make sure all dependencies are installed
   - Run `npm install` if needed

3. **Permission Errors**
   - Ensure you're logged in to npm
   - Verify you have access to the package
   - Check if you're using the correct npm registry

## Best Practices

1. **Version Control**
   - Commit all changes before publishing
   - Tag releases in Git after successful publish
   ```bash
   git tag v0.1.12
   git push origin v0.1.12
   ```

2. **Testing**
   - Always test the package locally before publishing
   - Test on different environments if possible

3. **Documentation**
   - Update README.md if there are new features
   - Document breaking changes
   - Update version history

4. **Changelog**
   - Keep a CHANGELOG.md file
   - Document all significant changes
   - Include migration guides for breaking changes

## Rollback Procedure

If you need to unpublish a version:

1. **Unpublish** (within 72 hours of publishing)
   ```bash
   npm unpublish simstudio@0.1.12
   ```

2. **Deprecate** (after 72 hours)
   ```bash
   npm deprecate simstudio@0.1.12 "This version has issues, please use 0.1.13"
   ```

## Automated Publishing

For automated publishing, you can use GitHub Actions. Add a workflow file in `.github/workflows/publish.yml`:

```yaml
name: Publish Package

on:
  release:
    types: [created]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm run build
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

## Support

If you encounter any issues:
1. Check the npm documentation
2. Review the package's GitHub issues
3. Contact the Sim Studio team 