#!/usr/bin/env python3

import argparse
import shlex
import sys

import pexpect


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", nargs="?", help="remote command to execute")
    parser.add_argument("--host", default="deezx")
    parser.add_argument("--password", default=" ")
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument("--shell", action="store_true", help="open interactive shell")
    args = parser.parse_args()

    ssh_cmd = (
        f"ssh -o StrictHostKeyChecking=no "
        f"-o PreferredAuthentications=password "
        f"-o PubkeyAuthentication=no root@{args.host}"
    )
    if args.command and not args.shell:
        ssh_cmd += f" {shlex.quote(args.command)}"

    child = pexpect.spawn(ssh_cmd, encoding="utf-8", timeout=args.timeout)
    try:
        index = child.expect([r"password:", r"yes/no", pexpect.EOF, pexpect.TIMEOUT])
        if index == 0:
            child.sendline(args.password)
        elif index == 1:
            child.sendline("yes")
            child.expect(r"password:")
            child.sendline(args.password)
        elif index == 2:
            return child.exitstatus or 0
        else:
            raise TimeoutError("timeout waiting for SSH prompt")

        child.logfile_read = sys.stdout

        if args.shell:
            child.interact()
        else:
            child.expect(pexpect.EOF)
        return child.exitstatus or 0
    finally:
        if child.isalive():
            child.close(force=True)


if __name__ == "__main__":
    raise SystemExit(main())