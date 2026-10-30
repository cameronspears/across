# Security policy

Across is meant to be safe to trust with a file: the server never sees the file, its name, or the secret in the link. If you find a way around that, or a way to take the service down cheaply, please tell us privately.

## Reporting

- Use GitHub's **Report a vulnerability** button on the Security tab of this repository. Reports stay private until a fix is out.
- Please don't open a public issue, and don't test against https://acrossfile.com at a volume that affects other people. `sh test/servers.sh` runs the whole service locally.
- Include what you did, what you expected, and what happened. A script or test is ideal.

## In scope

- Anything that lets the server, the relay, or a stranger read a file, its name, or the link's secret.
- Anything that reveals a person's IP address while their **Hide my IP address** switch is on.
- A malicious sender harming the receiver's browser or device beyond sending a file they chose to download.
- Cheap ways to exhaust the service's limits or its relay budget for everyone.

## Out of scope

- Someone who has the link or the code getting the file. That is how sharing works.
- Rate limits being reachable with many IP addresses. They slow abuse; they can't stop a botnet.
