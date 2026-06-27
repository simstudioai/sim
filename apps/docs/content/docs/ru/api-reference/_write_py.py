import sys
# Read content from stdin and write to the target file
content = sys.stdin.read()
with open('apps/docs/content/docs/ru/api-reference/python.mdx', 'w') as f:
    f.write(content)
print('Written', len(content), 'bytes')
