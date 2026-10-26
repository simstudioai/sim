# Sim adds an Amazon EC2 block

Status: editorial draft. Availability and media require review before an article is added.

## Editorial selection

Story type: feature

The Amazon EC2 integration (v0.9.32) is the strongest user-facing story: a new block with 25 concrete operations covering instance control, networking, EBS, and tagging. Knowledge base import (v0.9.32, same release tag) qualifies as a supporting note. Other batch items (token encryption, callerless CLI scope fix, scheduled-job runtime, Stripe webhook fix, gpt-4.1-nano deprecation, workflow-test mock fix, json input type fix, MCP DNS fix) are either on a different release tag (v0.9.33) or routine fixes. EC2 beats KB import as lead because it adds a wholly new integration surface rather than completing an existing export flow.

## Proposed article

Sim's Amazon EC2 block lets agents and workflows manage instances, Elastic IPs, VPC networking, EBS volumes and snapshots, and resource tags using an AWS access key.

The Amazon EC2 block gives agents and workflows direct access to AWS compute infrastructure. Operations cover instance lifecycle (describe, start, stop, reboot, terminate), Elastic IP management (allocate, associate, release), VPC networking (security groups, subnets, route tables, NAT gateways, and more), EBS volumes and snapshots, and resource tagging.

Authenticate with an AWS access key ID and secret access key and set a target region. Grant the IAM principal only the EC2 actions your operations require. See the [Amazon EC2 integration guide](https://docs.sim.ai/integrations/ec2) for setup and the full list of operations.

### Also in v0.9.32

- Knowledge bases can be imported from a `.simkb.zip` archive via the CLI or API, preserving documents, tags, chunking config, and settings. See the [export and import guide](https://docs.sim.ai/knowledgebase/export-import).

## Editorial review

- Rewrote body to group capabilities concisely instead of exhaustively listing every VPC sub-resource and operation; pointed readers to the docs for the full list of 25 operations.
- Removed pagination and filter implementation details from body per editorial guidelines; retained in claims for evidence.
- Removed 'now' from social and 'new'/'is available' from email to comply with automatic-draft rollout language restrictions.
- Simplified KB import supporting note: removed vector-matching and re-embedding details from body; these remain in claims.
- Both sources share the v0.9.32 release tag, so the Also in section is valid.
- Draft availability for both EC2 and KB import is listed as Unverified in evidence — questions ask owner to confirm Cloud availability.

## Source evidence

- The Amazon EC2 block supports instance lifecycle operations: describe instances, describe instance status, start, stop (with hibernate and force options), reboot, and terminate. — simstudioai/sim#9304
- The block covers VPC networking: VPCs, subnets, route tables, NAT gateways, internet gateways, security groups, network interfaces, network ACLs, VPC endpoints, and VPC peering connections. — simstudioai/sim#9304
- The block includes Elastic IP management (allocate, associate, disassociate, release), EBS operations (describe volumes, describe snapshots, create snapshot, delete), security group ingress rule control, and resource tagging. — simstudioai/sim#9304
- The block authenticates with an AWS access key ID and secret access key and runs in the configured region, like other AWS blocks in Sim. — simstudioai/sim#9304
- Knowledge base import creates a new base from a .simkb.zip archive, preserving documents, tag definitions and values, chunking configuration, and enabled flags. When the archive's vectors match the deployment's embedding model and dimensions, documents are indexed directly without re-embedding. — simstudioai/sim#9327

- https://github.com/simstudioai/sim/pull/9304
- https://github.com/simstudioai/sim/pull/9327

## Availability and open questions

- [ ] Has the Amazon EC2 block been confirmed available on Sim Cloud, or is it self-hosted only at this point?
- [ ] Has the knowledge base import feature been confirmed available on Sim Cloud?
- [ ] Are there any plan or tier requirements for the EC2 block beyond an AWS access key?
- [ ] Should the announcement note that destructive EC2 operations (terminate, stop, delete) are available, or does Sim gate them with a permission?
- [ ] Which block-picker category does the EC2 block appear under (DevOps, integrations, or another)?

## Links checked during drafting

- [Amazon EC2 integration guide](https://docs.sim.ai/integrations/ec2)
- [Amazon EC2 on sim.ai](https://www.sim.ai/integrations/amazon-ec2)
- [Knowledge base export and import](https://docs.sim.ai/knowledgebase/export-import)
- [Knowledge base docs](https://docs.sim.ai/knowledgebase)
- [CLI knowledge reference](https://docs.sim.ai/cli/knowledge)

## Media production

Format: video · 30 seconds
Subject: Amazon EC2 block in a Sim workflow
Starting state: Sim workflow canvas open with block picker visible, no EC2 block yet added
Action: User opens block picker, selects Amazon EC2, chooses Describe Instances operation, fills in AWS region, and runs the block
Visible result: Result panel shows returned instance data from a live describe call against a test AWS account
Poster: EC2 block configured with operation dropdown open showing available operations
Framing: 390px-wide canvas view centered on the EC2 block and its configuration panel, readable field labels visible
Demonstration limits: Capture against a real AWS test account with read-only IAM credentials configured before recording begins; do not fabricate instance data or imply credentials were accepted without real authentication. Verify the block appears in its category in the block picker before capture.

Capture a 30-second screen recording showing the Amazon EC2 block being added to a Sim workflow, an operation selected, and a result returned. Use a clean sample-data workspace at 390px-wide framing. AWS read-only IAM credentials must be configured before capture — never show fake key entry. The recording should show the block picker, the EC2 block selected, an operation chosen, and a successful result panel.

1. Open the block picker in a Sim workflow canvas with the EC2 block visible in its category
2. Select the Amazon EC2 block and show the operation dropdown with representative options (Describe Instances, Stop Instances, Describe Security Groups)
3. Show the configured block with AWS region and credential fields filled (non-sensitive sample values, real credentials set beforehand)
4. Run the block with a read-only Describe Instances operation and hold the result panel showing returned instance data

Suggested alt text: Sim workflow canvas showing the Amazon EC2 block with the Describe Instances operation selected and a result panel displaying instance data

- [ ] Independently verify the feature and rollout; record evidence and limitations.
- [ ] Review a product capture, verified diagram, or original editorial illustration; retain capture or generation provenance.
- [ ] Choose the final image or video poster; verify it reads clearly at 390px. Candidate assets are not approved media.
- [ ] Add optimized versioned media, captions if spoken, and index.mdx with draft: true.
- [ ] Verify the final media on desktop and mobile and run the content audit.
- [ ] Feature owner confirms availability; editor approves copy and links.
- [ ] After the approved site deployment, verify article, media, RSS and sitemap before marking published.

## Announcement drafts

**Social**

Sim has an Amazon EC2 block. Agents and workflows can manage instances, Elastic IPs, VPC networking, EBS volumes, and resource tags — all with an AWS access key. https://docs.sim.ai/integrations/ec2

**Email**

Sim's Amazon EC2 block lets you connect an AWS access key to manage instances, Elastic IPs, VPC networking, EBS volumes and snapshots, and resource tags. Grant the IAM principal only the EC2 actions your operations require. Details: https://docs.sim.ai/integrations/ec2

Final canonical URL is assigned when the reviewed article slug is chosen. Do not distribute these drafts before publication.

Editorial contract: apps/sim/content/changelog/README.md and editorial-standard.md. This brief is public repository content; keep private operational evidence in Sim.
