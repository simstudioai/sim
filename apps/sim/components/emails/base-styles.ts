// Base styles for all email templates

export const baseStyles = {
  fontFamily: 'HelveticaNeue, Helvetica, Arial, sans-serif',
  main: {
    backgroundColor: '#f5f5f7',
    fontFamily: 'HelveticaNeue, Helvetica, Arial, sans-serif',
  },
  container: {
    maxWidth: '580px',
    margin: '30px auto',
    backgroundColor: '#ffffff',
    borderRadius: '5px',
    overflow: 'hidden',
  },
  header: {
    padding: '30px 0',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  content: {
    padding: '5px 30px 20px 30px',
  },
  paragraph: {
    fontSize: '16px',
    lineHeight: '1.5',
    color: '#333333',
    margin: '16px 0',
  },
  button: {
    display: 'inline-block',
    backgroundColor: 'var(--brand-primary-hover-hex)',
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: '16px',
    padding: '12px 30px',
    borderRadius: '5px',
    textDecoration: 'none',
    textAlign: 'center' as const,
    margin: '20px 0',
  },
  link: {
    color: 'var(--brand-primary-hover-hex)',
    textDecoration: 'underline',
  },
  footer: {
    maxWidth: '580px',
    margin: '0 auto',
    padding: '20px 0',
    textAlign: 'center' as const,
  },
  footerText: {
    fontSize: '12px',
    color: '#666666',
    margin: '0',
  },
  codeContainer: {
    margin: '20px 0',
    padding: '16px',
    backgroundColor: '#f8f9fa',
    borderRadius: '5px',
    border: '1px solid #eee',
    textAlign: 'center' as const,
  },
  code: {
    fontSize: '28px',
    fontWeight: 'bold',
    letterSpacing: '4px',
    color: '#333333',
  },
  sectionsBorders: {
    width: '100%',
    display: 'flex',
  },
  sectionBorder: {
    borderBottom: '1px solid #eeeeee',
    width: '249px',
  },
  sectionCenter: {
    borderBottom: '1px solid var(--brand-primary-hover-hex)',
    width: '102px',
  },
}
