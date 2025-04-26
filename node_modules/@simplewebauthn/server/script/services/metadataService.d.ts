import type { MetadataStatement } from '../metadata/mdsTypes.js';
/**
 * Allow MetadataService to accommodate unregistered AAGUIDs (`"permissive"`), or only allow
 * registered AAGUIDs (`"strict"`). Currently primarily impacts how `getStatement()` operates
 */
export type VerificationMode = 'permissive' | 'strict';
interface MetadataService {
    /**
     * Prepare the service to handle remote MDS servers and/or cache local metadata statements.
     *
     * **Options:**
     *
     * @param opts.mdsServers An array of URLs to FIDO Alliance Metadata Service
     * (version 3.0)-compatible servers. Defaults to the official FIDO MDS server
     * @param opts.statements An array of local metadata statements
     * @param opts.verificationMode How MetadataService will handle unregistered AAGUIDs. Defaults to
     * `"strict"` which throws errors during registration response verification when an
     * unregistered AAGUID is encountered. Set to `"permissive"` to allow registration by
     * authenticators with unregistered AAGUIDs
     */
    initialize(opts?: {
        mdsServers?: string[];
        statements?: MetadataStatement[];
        verificationMode?: VerificationMode;
    }): Promise<void>;
    /**
     * Get a metadata statement for a given AAGUID.
     *
     * This method will coordinate updating the cache as per the `nextUpdate` property in the initial
     * BLOB download.
     */
    getStatement(aaguid: string | Uint8Array): Promise<MetadataStatement | undefined>;
}
/**
 * An implementation of `MetadataService` that can download and parse BLOBs, and support on-demand
 * requesting and caching of individual metadata statements.
 *
 * https://fidoalliance.org/metadata/
 */
export declare class BaseMetadataService implements MetadataService {
    private mdsCache;
    private statementCache;
    private state;
    private verificationMode;
    initialize(opts?: {
        mdsServers?: string[];
        statements?: MetadataStatement[];
        verificationMode?: VerificationMode;
    }): Promise<void>;
    getStatement(aaguid: string | Uint8Array): Promise<MetadataStatement | undefined>;
    /**
     * Download and process the latest BLOB from MDS
     */
    private downloadBlob;
    /**
     * A helper method to pause execution until the service is ready
     */
    private pauseUntilReady;
    /**
     * Report service status on change
     */
    private setState;
}
/**
 * A basic service for coordinating interactions with the FIDO Metadata Service. This includes BLOB
 * download and parsing, and on-demand requesting and caching of individual metadata statements.
 *
 * https://fidoalliance.org/metadata/
 */
export declare const MetadataService: MetadataService;
export {};
//# sourceMappingURL=metadataService.d.ts.map