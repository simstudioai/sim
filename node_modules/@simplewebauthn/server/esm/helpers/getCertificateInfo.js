import { AsnParser } from '@peculiar/asn1-schema';
import { BasicConstraints, Certificate, id_ce_basicConstraints } from '@peculiar/asn1-x509';
const issuerSubjectIDKey = {
    '2.5.4.6': 'C',
    '2.5.4.10': 'O',
    '2.5.4.11': 'OU',
    '2.5.4.3': 'CN',
};
/**
 * Extract PEM certificate info
 *
 * @param pemCertificate Result from call to `convertASN1toPEM(x5c[0])`
 */
export function getCertificateInfo(leafCertBuffer) {
    const x509 = AsnParser.parse(leafCertBuffer, Certificate);
    const parsedCert = x509.tbsCertificate;
    // Issuer
    const issuer = { combined: '' };
    parsedCert.issuer.forEach(([iss]) => {
        const key = issuerSubjectIDKey[iss.type];
        if (key) {
            issuer[key] = iss.value.toString();
        }
    });
    issuer.combined = issuerSubjectToString(issuer);
    // Subject
    const subject = { combined: '' };
    parsedCert.subject.forEach(([iss]) => {
        const key = issuerSubjectIDKey[iss.type];
        if (key) {
            subject[key] = iss.value.toString();
        }
    });
    subject.combined = issuerSubjectToString(subject);
    let basicConstraintsCA = false;
    if (parsedCert.extensions) {
        // console.log(parsedCert.extensions);
        for (const ext of parsedCert.extensions) {
            if (ext.extnID === id_ce_basicConstraints) {
                const basicConstraints = AsnParser.parse(ext.extnValue, BasicConstraints);
                basicConstraintsCA = basicConstraints.cA;
            }
        }
    }
    return {
        issuer,
        subject,
        version: parsedCert.version,
        basicConstraintsCA,
        notBefore: parsedCert.validity.notBefore.getTime(),
        notAfter: parsedCert.validity.notAfter.getTime(),
        parsedCertificate: x509,
    };
}
/**
 * Stringify the parts of Issuer or Subject info for easier comparison of subject issuers with
 * issuer subjects.
 *
 * The order might seem arbitrary, because it is. It should be enough that the two are stringified
 * in the same order.
 */
function issuerSubjectToString(input) {
    const parts = [];
    if (input.C) {
        parts.push(input.C);
    }
    if (input.O) {
        parts.push(input.O);
    }
    if (input.OU) {
        parts.push(input.OU);
    }
    if (input.CN) {
        parts.push(input.CN);
    }
    return parts.join(' : ');
}
