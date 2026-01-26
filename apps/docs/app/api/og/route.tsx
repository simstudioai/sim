import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'

export const runtime = 'edge'

const TITLE_FONT_SIZE = {
  large: 64,
  medium: 56,
  small: 48,
} as const

function getTitleFontSize(title: string): number {
  if (title.length > 45) return TITLE_FONT_SIZE.small
  if (title.length > 30) return TITLE_FONT_SIZE.medium
  return TITLE_FONT_SIZE.large
}

/**
 * Loads a Google Font dynamically by fetching the CSS and extracting the font URL.
 */
async function loadGoogleFont(font: string, weights: string, text: string): Promise<ArrayBuffer> {
  const url = `https://fonts.googleapis.com/css2?family=${font}:wght@${weights}&text=${encodeURIComponent(text)}`
  const css = await (await fetch(url)).text()
  const resource = css.match(/src: url\((.+)\) format\('(opentype|truetype)'\)/)

  if (resource) {
    const response = await fetch(resource[1])
    if (response.status === 200) {
      return await response.arrayBuffer()
    }
  }

  throw new Error('Failed to load font data')
}

/**
 * Sim logo with icon and "Sim" text for OG image.
 */
function SimLogoFull() {
  return (
    <svg height='28' viewBox='720 440 1020 320' fill='none'>
      {/* Green icon - top left shape with cutout */}
      <path
        fillRule='evenodd'
        clipRule='evenodd'
        d='M875.791 577.171C875.791 581.922 873.911 586.483 870.576 589.842L870.098 590.323C866.764 593.692 862.234 595.575 857.517 595.575H750.806C740.978 595.575 733 603.6 733 613.498V728.902C733 738.799 740.978 746.826 750.806 746.826H865.382C875.209 746.826 883.177 738.799 883.177 728.902V620.853C883.177 616.448 884.912 612.222 888.008 609.104C891.093 605.997 895.29 604.249 899.664 604.249H1008.16C1017.99 604.249 1025.96 596.224 1025.96 586.327V470.923C1025.96 461.025 1017.99 453 1008.16 453H893.586C883.759 453 875.791 461.025 875.791 470.923V577.171ZM910.562 477.566H991.178C996.922 477.566 1001.57 482.254 1001.57 488.029V569.22C1001.57 574.995 996.922 579.683 991.178 579.683H910.562C904.828 579.683 900.173 574.995 900.173 569.22V488.029C900.173 482.254 904.828 477.566 910.562 477.566Z'
        fill='#33C482'
      />
      {/* Green icon - bottom right square */}
      <path
        d='M1008.3 624.59H923.113C912.786 624.59 904.414 633.022 904.414 643.423V728.171C904.414 738.572 912.786 747.004 923.113 747.004H1008.3C1018.63 747.004 1027 738.572 1027 728.171V643.423C1027 633.022 1018.63 624.59 1008.3 624.59Z'
        fill='#33C482'
      />
      {/* "Sim" text - white for dark background */}
      <path
        d='M1210.54 515.657C1226.65 515.657 1240.59 518.51 1252.31 524.257H1252.31C1264.3 529.995 1273.63 538.014 1280.26 548.319H1280.26C1287.19 558.635 1290.78 570.899 1291.08 585.068L1291.1 586.089H1249.11L1249.09 585.115C1248.8 574.003 1245.18 565.493 1238.32 559.451C1231.45 553.399 1221.79 550.308 1209.21 550.308C1196.3 550.308 1186.48 553.113 1179.61 558.588C1172.76 564.046 1169.33 571.499 1169.33 581.063C1169.33 588.092 1171.88 593.978 1177.01 598.783C1182.17 603.618 1189.99 607.399 1200.56 610.061H1200.56L1238.77 619.451C1257.24 623.65 1271.21 630.571 1280.57 640.293L1281.01 640.739C1290.13 650.171 1294.64 662.97 1294.64 679.016C1294.64 692.923 1290.88 705.205 1283.34 715.822L1283.33 715.834C1275.81 726.134 1265.44 734.14 1252.26 739.866L1252.25 739.871C1239.36 745.302 1224.12 748 1206.54 748C1180.9 748 1160.36 741.696 1145.02 728.984C1129.67 716.258 1122 699.269 1122 678.121V677.121H1163.99V678.121C1163.99 688.869 1167.87 697.367 1175.61 703.722L1176.34 704.284C1184.04 709.997 1194.37 712.902 1207.43 712.902C1222.13 712.902 1233.3 710.087 1241.07 704.588C1248.8 698.812 1252.64 691.21 1252.64 681.699C1252.64 674.769 1250.5 669.057 1246.25 664.49L1246.23 664.478L1246.22 664.464C1242.28 659.929 1234.83 656.119 1223.64 653.152L1185.43 644.208L1185.42 644.204C1166.05 639.407 1151.49 632.035 1141.83 622.012L1141.83 622.006L1141.82 622C1132.43 611.94 1127.78 598.707 1127.78 582.405C1127.78 568.81 1131.23 556.976 1138.17 546.949L1138.18 546.941L1138.19 546.933C1145.41 536.936 1155.18 529.225 1167.48 523.793L1167.48 523.79C1180.07 518.36 1194.43 515.657 1210.54 515.657ZM1323.39 521.979C1331.68 525.008 1337.55 526.482 1343.51 526.482C1349.48 526.482 1355.64 525.005 1364.49 521.973L1365.82 521.52V742.633H1322.05V521.489L1323.39 521.979ZM1642.01 515.657C1667.11 515.657 1686.94 523.031 1701.39 537.876C1715.83 552.716 1723 572.968 1723 598.507V742.633H1680.12V608.794C1680.12 591.666 1675.72 578.681 1667.07 569.681L1667.06 569.669L1667.04 569.656C1658.67 560.359 1647.26 555.675 1632.68 555.675C1622.47 555.675 1613.47 558.022 1605.64 562.69L1605.63 562.696C1598.11 567.064 1592.17 573.475 1587.8 581.968C1583.44 590.448 1581.25 600.424 1581.25 611.925V742.633H1537.92V608.347C1537.92 591.208 1533.67 578.376 1525.31 569.68L1525.31 569.674L1525.3 569.668C1516.93 560.664 1505.52 556.122 1490.93 556.122C1480.72 556.122 1471.72 558.469 1463.89 563.138L1463.88 563.144C1456.36 567.511 1450.41 573.922 1446.05 582.415L1446.05 582.422L1446.04 582.428C1441.69 590.602 1439.5 600.423 1439.5 611.925V742.633H1395.72V521.919H1435.05V554.803C1439.92 544.379 1447.91 535.465 1458.37 528.356C1470.71 519.875 1485.58 515.657 1502.93 515.657C1522.37 515.657 1538.61 520.931 1551.55 531.538C1560.38 538.771 1567.1 547.628 1571.72 558.091C1576.05 547.619 1582.83 538.757 1592.07 531.524C1605.61 520.93 1622.28 515.657 1642.01 515.657ZM1343.49 452C1351.45 452 1358.23 454.786 1363.75 460.346C1369.27 465.905 1372.04 472.721 1372.04 480.73C1372.04 488.452 1369.27 495.254 1363.77 501.096L1363.76 501.105L1363.75 501.115C1358.23 506.675 1351.45 509.461 1343.49 509.461C1335.81 509.461 1329.05 506.669 1323.25 501.134L1323.23 501.115L1323.21 501.096C1317.71 495.254 1314.94 488.452 1314.94 480.73C1314.94 472.721 1317.7 465.905 1323.23 460.346L1323.24 460.337L1323.25 460.327C1329.05 454.792 1335.81 452 1343.49 452Z'
        fill='#fafafa'
      />
    </svg>
  )
}

/**
 * Generates dynamic Open Graph images for documentation pages.
 * Style matches Cursor docs: dark background, title at top, logo bottom-left, domain bottom-right.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const title = searchParams.get('title') || 'Documentation'

  const allText = `${title}docs.sim.ai`
  const fontData = await loadGoogleFont('Geist', '400;500;600', allText)

  return new ImageResponse(
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '56px 64px',
        background: '#121212', // Dark mode background matching docs (hsla 0, 0%, 7%)
        fontFamily: 'Geist',
      }}
    >
      {/* Title at top */}
      <span
        style={{
          fontSize: getTitleFontSize(title),
          fontWeight: 500,
          color: '#fafafa', // Light text matching docs
          lineHeight: 1.2,
          letterSpacing: '-0.02em',
        }}
      >
        {title}
      </span>

      {/* Footer: icon left, domain right */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          width: '100%',
        }}
      >
        <SimLogoFull />
        <span
          style={{
            fontSize: 20,
            fontWeight: 400,
            color: '#71717a',
          }}
        >
          docs.sim.ai
        </span>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: 'Geist',
          data: fontData,
          style: 'normal',
        },
      ],
    }
  )
}
