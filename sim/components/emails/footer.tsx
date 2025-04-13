import { Container, Img, Link, Section, Text } from '@react-email/components'

interface EmailFooterProps {
  baseUrl?: string
}

export const EmailFooter = ({
  baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai',
}: EmailFooterProps) => {
  return (
    <Container>
      <Section style={{ maxWidth: '580px', margin: '0 auto', padding: '20px 0' }}>
        <table style={{ width: '100%' }}>
          <tr>
            <td align="center">
              <table cellPadding={0} cellSpacing={0} style={{ border: 0 }}>
                <tr>
                  <td align="center" style={{ padding: '0 8px' }}>
                    <Link href="https://x.com/simstudioai">
                      <Img src={`${baseUrl}/static/x-icon.png`} width="24" height="24" alt="X" />
                    </Link>
                  </td>
                  <td align="center" style={{ padding: '0 8px' }}>
                    <Link href="https://discord.gg/Hr4UWYEcTT">
                      <Img
                        src={`${baseUrl}/static/discord-icon.png`}
                        width="24"
                        height="24"
                        alt="Discord"
                      />
                    </Link>
                  </td>
                  <td align="center" style={{ padding: '0 8px' }}>
                    <Link href="https://github.com/simstudioai/sim">
                      <Img
                        src={`${baseUrl}/static/github-icon.png`}
                        width="24"
                        height="24"
                        alt="GitHub"
                      />
                    </Link>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style={{ paddingTop: '12px' }}>
              <Text
                style={{
                  fontSize: '12px',
                  color: '#706a7b',
                  margin: '8px 0 0 0',
                }}
              >
                © {new Date().getFullYear()} Sim Studio, All Rights Reserved
                <br />
                If you have any questions, please contact us at{' '}
                <a
                  href="mailto:help@simstudio.ai"
                  style={{
                    color: '#706a7b !important',
                    textDecoration: 'underline',
                    fontWeight: 'normal',
                    fontFamily: 'HelveticaNeue, Helvetica, Arial, sans-serif',
                  }}
                >
                  help@simstudio.ai
                </a>
              </Text>
              <table cellPadding={0} cellSpacing={0} style={{ width: '100%', marginTop: '4px' }}>
                <tr>
                  <td align="center">
                    <p
                      style={{
                        fontSize: '12px',
                        color: '#706a7b',
                        margin: '8px 0 0 0',
                        fontFamily: 'HelveticaNeue, Helvetica, Arial, sans-serif',
                      }}
                    >
                      <a
                        href={`${baseUrl}/privacy`}
                        style={{
                          color: '#706a7b !important',
                          textDecoration: 'underline',
                          fontWeight: 'normal',
                          fontFamily: 'HelveticaNeue, Helvetica, Arial, sans-serif',
                        }}
                      >
                        Privacy Policy
                      </a>{' '}
                      •{' '}
                      <a
                        href={`${baseUrl}/terms`}
                        style={{
                          color: '#706a7b !important',
                          textDecoration: 'underline',
                          fontWeight: 'normal',
                          fontFamily: 'HelveticaNeue, Helvetica, Arial, sans-serif',
                        }}
                      >
                        Terms of Service
                      </a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </Section>
    </Container>
  )
}

export default EmailFooter
