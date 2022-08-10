# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
#!/usr/bin/env python3

import aws_cdk as cdk 

from vpc_cdk.devsecops_cdk_vpc import devsecopsCdkStackVPC

env=cdk.Environment(region="us-west-2", account="704533066374")

app = cdk.App()

mwaa_hybrid_backend = devsecopsCdkStackVPC(
    scope=app,
    id="devsecops-vpc",
    env=env
)



app.synth()
