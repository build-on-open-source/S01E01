"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EksDevsecopsObservabilityStack = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const stream_1 = require("stream");
class EksDevsecopsObservabilityStack extends aws_cdk_lib_1.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Fetch existing VPC
        const vpc = aws_cdk_lib_1.aws_ec2.Vpc.fromLookup(this, 'VPC', {
            vpcId: 'vpc-01b34768a4eb4980e'
        });
        // EKS Cluster
        const clusterRole = new aws_cdk_lib_1.aws_iam.Role(this, 'ClusterRole', {
            assumedBy: new aws_cdk_lib_1.aws_iam.AccountRootPrincipal()
        });
        const cluster = new aws_cdk_lib_1.aws_eks.Cluster(this, 'EKS_Cluster', {
            vpc: vpc,
            endpointAccess: aws_cdk_lib_1.aws_eks.EndpointAccess.PUBLIC_AND_PRIVATE,
            mastersRole: clusterRole,
            version: aws_cdk_lib_1.aws_eks.KubernetesVersion.V1_21,
            defaultCapacity: 0,
            clusterName: 'eks-cluster',
            clusterLogging: [
                aws_cdk_lib_1.aws_eks.ClusterLoggingTypes.API,
                aws_cdk_lib_1.aws_eks.ClusterLoggingTypes.AUTHENTICATOR,
                aws_cdk_lib_1.aws_eks.ClusterLoggingTypes.SCHEDULER,
                aws_cdk_lib_1.aws_eks.ClusterLoggingTypes.CONTROLLER_MANAGER,
                aws_cdk_lib_1.aws_eks.ClusterLoggingTypes.AUDIT
            ],
        });
        // Enable access from the console - change the user to the one you want - I am using "ops"
        const addConsoleAccess = aws_cdk_lib_1.aws_iam.User.fromUserName(this, "existing admin", "ops");
        cluster.awsAuth.addUserMapping(addConsoleAccess, { groups: ["system:masters"] });
        //
        // Choice of Node groups with and without LaunchTemplate specifications
        //
        cluster.addNodegroupCapacity('extra-ng-without-lt', {
            instanceTypes: [
                new aws_cdk_lib_1.aws_ec2.InstanceType('t3.small'),
            ],
            minSize: 1,
            maxSize: 2,
            nodegroupName: 'extra-ng-without-lt',
        });
        const launchTemplateRequireImdsv2Aspect = new aws_cdk_lib_1.aws_ec2.LaunchTemplateRequireImdsv2Aspect(/* all optional props */ {
            suppressWarnings: false,
        });
        const userData = aws_cdk_lib_1.aws_ec2.UserData.forLinux();
        userData.addCommands('set -o xtrace', `/etc/eks/bootstrap.sh ${cluster.clusterName}`);
        const lt = new aws_cdk_lib_1.aws_ec2.CfnLaunchTemplate(this, 'LaunchTemplate', {
            launchTemplateData: {
                imageId: 'ami-061944722678088b6',
                instanceType: 't3.small',
                userData: aws_cdk_lib_1.Fn.base64(userData.render()),
                metadataOptions: {
                    httpTokens: 'required',
                    httpPutResponseHopLimit: 1,
                },
            },
        });
        cluster.addNodegroupCapacity('extra-ng-with-lt', {
            launchTemplateSpec: {
                id: lt.ref,
                version: lt.attrLatestVersionNumber,
            },
        });
        // ECR Repository 
        const ecrRepo = new aws_cdk_lib_1.aws_ecr.Repository(this, 'devsecops-repo-ecr', {
            //    repositoryName: 'devsecops-repo-ecr', 
            encryption: aws_cdk_lib_1.aws_ecr.RepositoryEncryption.KMS,
            imageTagMutability: aws_cdk_lib_1.aws_ecr.TagMutability.MUTABLE,
            imageScanOnPush: true
        });
        const repo = new aws_cdk_lib_1.aws_codecommit.Repository(this, "devsecops-eks-cc-repository", {
            repositoryName: "devsecops-eks-cc-repository",
            description: "devsecops-eks-cc-repository",
        });
        const kmskey = new aws_cdk_lib_1.aws_kms.Key(this, 'MyKey', {
            enableKeyRotation: true,
        });
        const buildRole = new aws_cdk_lib_1.aws_iam.Role(this, 'EKSCodeBuildRole', {
            assumedBy: new aws_cdk_lib_1.aws_iam.ServicePrincipal('codebuild.amazonaws.com'),
            description: 'EKS CB Role',
        });
        buildRole.addManagedPolicy(aws_cdk_lib_1.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('SecretsManagerReadWrite'));
        // Fetch DockerHub secrets for docker-cli login
        const dockerhub = aws_cdk_lib_1.aws_secretsmanager.Secret.fromSecretNameV2(this, 'dockerhub', 'dockerhub');
        const dockerhubtwo = aws_cdk_lib_1.aws_secretsmanager.Secret.fromSecretNameV2(this, 'dockerhubtwo', 'dockerhubtwo');
        buildRole.addToPolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            sid: 'StsAccess',
            actions: [
                "sts:AssumeRole",
                "sts:SetSourceIdentity"
            ],
            resources: [
                buildRole.roleArn
            ],
        }));
        buildRole.addToPolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            sid: 'SecretsAccess',
            actions: [
                "secretsmanager:GetSecretValue"
            ],
            resources: [
                dockerhub.secretArn,
                dockerhubtwo.secretArn
            ],
        }));
        buildRole.addToPolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            sid: 'AccessDecodeAuth',
            actions: [
                "sts:DecodeAuthorizationMessage",
            ],
            resources: [buildRole.roleArn],
        }));
        buildRole.addToPolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            sid: 'DescribeEKS',
            actions: [
                "eks:DescribeAddon",
                "eks:DescribeCluster",
                "eks:DescribeIdentityProviderConfig",
                "eks:DescribeNodegroup",
                "eks:DescribeUpdate"
            ],
            resources: [`${cluster.clusterArn}`],
        }));
        // CODEBUILD - project - IaC Security
        const codebuildCheckov = new aws_cdk_lib_1.aws_codebuild.PipelineProject(this, "cdkdeploycheckov", {
            projectName: 'cdk_security_check_checkov',
            role: buildRole,
            encryptionKey: kmskey,
            environment: {
                computeType: aws_cdk_lib_1.aws_codebuild.ComputeType.SMALL,
                buildImage: aws_cdk_lib_1.aws_codebuild.LinuxBuildImage.fromDockerRegistry("public.ecr.aws/ackstorm/checkov:latest"),
                privileged: false,
            },
            buildSpec: aws_cdk_lib_1.aws_codebuild.BuildSpec.fromObject({
                version: "0.2",
                phases: {
                    build: {
                        commands: [
                            'skip_checks=`paste -d, -s kubernetes/skip_checks.config`',
                            'checkov --framework cloudformation --skip-check $skip_checks -f cdk.out/EksDevsecopsObservabilityStack.template.json',
                        ]
                    },
                },
                artifacts: {
                    files: [
                        'kubernetes/*',
                        'Dockerfile',
                        'requirements.txt',
                        'server.py',
                    ]
                }
            })
        });
        // CODEBUILD - project - Static Scan
        const project = new aws_cdk_lib_1.aws_codebuild.Project(this, 'devsecops-project-eks-static-scan', {
            projectName: 'devsecops-project-eks-static-scan',
            role: buildRole,
            encryptionKey: kmskey,
            environment: {
                buildImage: aws_cdk_lib_1.aws_codebuild.LinuxBuildImage.AMAZON_LINUX_2_2,
                privileged: true,
            },
            environmentVariables: {
                'ECR_REPOSITORY_URI': {
                    value: `${ecrRepo.repositoryUri}`
                },
                'AWS_DEFAULT_REGION': {
                    value: `${aws_cdk_lib_1.Aws.REGION}`
                },
                'HADOLINT_IMAGE_TAG': {
                    value: `hadolint-latest`
                },
                'IMAGE_REPO_NAME': {
                    value: `${ecrRepo.repositoryName}`
                },
                'Account_Id': {
                    value: `${aws_cdk_lib_1.Aws.ACCOUNT_ID}`
                },
                'IMAGE_TAG': {
                    value: `app-latest`
                }
            },
            buildSpec: aws_cdk_lib_1.aws_codebuild.BuildSpec.fromObject({
                version: "0.2",
                phases: {
                    install: {
                        commands: [
                            'env',
                            // OPTIONAL - Below steps are to escape Github Rate limits. You can push to a private repository like Amazon ECR any image and pull/push infinitely      
                            'export TAG=${CODEBUILD_RESOLVED_SOURCE_VERSION}',
                            'export dockerhub_username=`aws secretsmanager get-secret-value --secret-id dockerhub| jq --raw-output ".SecretString" | jq -r .username`',
                            'export dockerhub_password=`aws secretsmanager get-secret-value --secret-id  dockerhubtwo| jq --raw-output ".SecretString" | jq -r .password`',
                            'echo "############Login to DockerHub############"',
                            'docker login -u $dockerhub_username -p $dockerhub_password',
                        ]
                    },
                    build: {
                        commands: [
                            'mkdir -p $CODEBUILD_SRC_DIR/build/',
                            'pwd',
                            'ls',
                            'cp kubernetes/hadolint.yaml $CODEBUILD_SRC_DIR/build/hadolint.yaml',
                            'cp Dockerfile $CODEBUILD_SRC_DIR/build/Dockerfile',
                            'cp requirements.txt $CODEBUILD_SRC_DIR/build/requirements.txt',
                            'cp server.py $CODEBUILD_SRC_DIR/build/server.py',
                            'echo "############DOCKER FILE LINT STATGE############"',
                            'ECR_LOGIN=$(aws ecr get-login --region $AWS_DEFAULT_REGION --no-include-email)',
                            'echo "############Logging in to Amazon ECR############"',
                            '$ECR_LOGIN',
                            // OPTIONAL - Below steps are to escape Github Rate limits. You can push to a private repository like Amazon ECR any image and pull/push infinitely            
                            // hadolint/hadolint:v1.16.2
                            // 'docker run --rm -i -v ${PWD}/.hadolint.yaml:/.hadolint.yaml hadolint/hadolint:latest hadolint -f json - < ./Dockerfile',
                            //'docker pull $ECR_REPOSITORY_URI:$HADOLINT_IMAGE_TAG',
                            'cd $CODEBUILD_SRC_DIR/build',
                            'ls -tlr',
                            //'docker run --rm -i -v ${PWD}/hadolint.yaml:/.hadolint.yaml $ECR_REPOSITORY_URI:$HADOLINT_IMAGE_TAG hadolint -f json - < ./Dockerfile',
                            'docker run --rm -i -v ${PWD}/hadolint.yaml:/.hadolint.yaml hadolint/hadolint:latest hadolint -f json - < ./Dockerfile',
                            'echo "############DOCKER FILE LINT STATGE - PASSED############"',
                            `docker build -f Dockerfile -t $ECR_REPOSITORY_URI:app-latest .`,
                            'docker tag $ECR_REPOSITORY_URI:app-latest $ECR_REPOSITORY_URI:$IMAGE_TAG',
                            'docker history --no-trunc $ECR_REPOSITORY_URI:$IMAGE_TAG'
                        ]
                    },
                    post_build: {
                        commands: [
                            'bash -c "if [ /"$CODEBUILD_BUILD_SUCCEEDING/" == /"0/" ]; then exit 1; fi"',
                            'echo Build completed on `date`',
                            'docker push $ECR_REPOSITORY_URI:$IMAGE_TAG',
                            'echo "Deep Vulnerability Scan By Anchore Engine"',
                            'echo "POST_BUILD Phase Will fail if Container fails with Vulnerabilities"',
                            'export COMPOSE_INTERACTIVE_NO_CLI=1',
                            'curl -s https://ci-tools.anchore.io/inline_scan-v0.3.3 | bash -s -- $ECR_REPOSITORY_URI:$IMAGE_TAG',
                        ]
                    }
                },
                artifacts: {
                    files: [
                        'kubernetes/*',
                        'Dockerfile',
                        'requirements.txt',
                        'server.py',
                    ]
                }
            })
        });
        // CODEBUILD - project - Deploy to EKS
        const projectEks = new aws_cdk_lib_1.aws_codebuild.Project(this, 'devsecops-project-eks-deploy', {
            projectName: 'devsecops-project-eks-deploy',
            role: buildRole,
            encryptionKey: kmskey,
            environment: {
                buildImage: aws_cdk_lib_1.aws_codebuild.LinuxBuildImage.AMAZON_LINUX_2_2,
                privileged: true,
            },
            environmentVariables: {
                'ECR_REPOSITORY_URI': {
                    value: `${ecrRepo.repositoryUri}`
                },
                'AWS_DEFAULT_REGION': {
                    value: `${aws_cdk_lib_1.Aws.REGION}`
                },
                'AWS_CLUSTER_NAME': {
                    value: `${cluster.clusterName}`
                },
                'HADOLINT_IMAGE_TAG': {
                    value: `hadolint-latest`
                },
                'IMAGE_REPO_NAME': {
                    value: `${ecrRepo.repositoryName}`
                },
                'Account_Id': {
                    value: `${aws_cdk_lib_1.Aws.ACCOUNT_ID}`
                },
                'IMAGE_TAG': {
                    value: `app-latest`
                }
            },
            buildSpec: aws_cdk_lib_1.aws_codebuild.BuildSpec.fromObject({
                version: "0.2",
                phases: {
                    pre_build: {
                        commands: [
                            'echo "############Installing app dependencies############"',
                            'curl -o kubectl https://amazon-eks.s3.us-west-2.amazonaws.com/1.18.9/2020-11-02/bin/linux/amd64/kubectl',
                            'chmod +x ./kubectl',
                            'mkdir -p $HOME/bin && cp ./kubectl $HOME/bin/kubectl && export PATH=$PATH:$HOME/bin',
                            'export PATH=$PATH:$HOME/bin >> ~/.bashrc',
                            'source ~/.bashrc',
                            'echo "############Check kubectl version############"',
                            'kubectl version --short --client',
                            'echo "############check config############"',
                            'aws eks update-kubeconfig --name $AWS_CLUSTER_NAME --region $AWS_DEFAULT_REGION',
                            'kubectl config view --minify',
                            'kubectl get configmap aws-auth -o yaml -n kube-system',
                        ]
                    },
                    build: {
                        commands: [
                            'echo "############Deploy to EKS Cluster############"',
                            'kubectl apply -f kubernetes/deployment.yaml',
                            'echo "############List Pods############"',
                            'kubectl get pods',
                            'docker images',
                        ]
                    }
                },
            })
        });
        cluster.awsAuth.addMastersRole(projectEks.role);
        project.addToRolePolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            actions: [
                "eks:DescribeAddon",
                "eks:DescribeCluster",
                "eks:DescribeIdentityProviderConfig",
                "eks:DescribeNodegroup",
                "eks:DescribeUpdate"
            ],
            resources: [`${cluster.clusterArn}`],
        }));
        // Pipleine for EKS
        const sourceOutput = new aws_cdk_lib_1.aws_codepipeline.Artifact();
        const buildOutput = new aws_cdk_lib_1.aws_codepipeline.Artifact();
        const buildcheckovOutput = new aws_cdk_lib_1.aws_codepipeline.Artifact();
        const deployOutput = new aws_cdk_lib_1.aws_codepipeline.Artifact();
        const sourceAction = new aws_cdk_lib_1.aws_codepipeline_actions.CodeCommitSourceAction({
            actionName: 'CodeCommit_Source',
            repository: repo,
            branch: 'main',
            output: sourceOutput
        });
        const checkovAction = new aws_cdk_lib_1.aws_codepipeline_actions.CodeBuildAction({
            actionName: 'CodeBuild',
            project: codebuildCheckov,
            input: sourceOutput,
            outputs: [buildcheckovOutput],
        });
        const buildAction = new aws_cdk_lib_1.aws_codepipeline_actions.CodeBuildAction({
            actionName: 'CodeBuild',
            project: project,
            input: buildcheckovOutput,
            outputs: [buildOutput],
        });
        const manualApprovalAction = new aws_cdk_lib_1.aws_codepipeline_actions.ManualApprovalAction({
            actionName: 'Approve',
        });
        const deployAction = new aws_cdk_lib_1.aws_codepipeline_actions.CodeBuildAction({
            actionName: 'CodeBuild',
            project: projectEks,
            input: buildOutput,
            outputs: [deployOutput],
        });
        new aws_cdk_lib_1.aws_codepipeline.Pipeline(this, 'devsecops-project-eks-pipeline', {
            stages: [
                {
                    stageName: 'Source-Input',
                    actions: [sourceAction],
                },
                {
                    stageName: 'Checkov-IaC-Code-Security-Checks',
                    actions: [checkovAction],
                },
                {
                    stageName: 'Approve-Checkov-Checks',
                    actions: [manualApprovalAction],
                },
                {
                    stageName: 'Container-Scan-Hadolint-AnchoreEngine',
                    actions: [buildAction],
                },
                {
                    stageName: 'Approve-Deployment',
                    actions: [manualApprovalAction],
                },
                {
                    stageName: 'Deploy-to-EKS',
                    actions: [deployAction],
                }
            ]
        });
        ecrRepo.grantPullPush(project.role);
        project.addToRolePolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            actions: [
                "ecr:GetAuthorizationToken",
                "ecr:BatchCheckLayerAvailability",
                "ecr:BatchGetImage",
                "ecr:GetDownloadUrlForLayer"
            ],
            resources: [ecrRepo.repositoryArn]
        }));
        // create an Output
        new aws_cdk_lib_1.CfnOutput(this, 'EKS_Cluster_Name', {
            value: cluster.clusterName,
            description: 'EKS Cluster',
            exportName: 'EKSClusterName',
        });
        new aws_cdk_lib_1.CfnOutput(this, 'ECRRepo', {
            value: ecrRepo.repositoryName,
            description: 'ECR Repo',
            exportName: 'ECRrepo',
        });
        new aws_cdk_lib_1.CfnOutput(this, 'CodeCommitRepo', {
            value: repo.repositoryName,
            description: 'CCRepo',
            exportName: 'CCrepo',
        });
        new aws_cdk_lib_1.CfnOutput(this, 'CodePipelineName', {
            value: stream_1.pipeline.name,
            description: 'CodePipeline',
            exportName: 'CPName',
        });
        new aws_cdk_lib_1.CfnOutput(this, 'StaticScanCodeBuild', {
            value: project.projectName,
            description: 'StaicScan CodeBuild',
            exportName: 'StaticScanProject',
        });
        new aws_cdk_lib_1.CfnOutput(this, 'EKSDeployCodeBuild', {
            value: projectEks.projectName,
            description: 'EKSDeploy CodeBuild',
            exportName: 'EKSDeployProject',
        });
        new aws_cdk_lib_1.CfnOutput(this, 'CheckovCodeBuild', {
            value: codebuildCheckov.projectName,
            description: 'Checkov CodeBuild',
            exportName: 'CheckovProject',
        });
    }
}
exports.EksDevsecopsObservabilityStack = EksDevsecopsObservabilityStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWtzLWRldnNlY29wcy1vYnNlcnZhYmlsaXR5LXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiZWtzLWRldnNlY29wcy1vYnNlcnZhYmlsaXR5LXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDZDQWUrQjtBQUUvQixtQ0FBa0M7QUFHbEMsTUFBYSw4QkFBK0IsU0FBUSxtQkFBSztJQUN2RCxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQWtCO1FBQzFELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRTVCLHFCQUFxQjtRQUVqQixNQUFNLEdBQUcsR0FBRyxxQkFBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRTtZQUM5QyxLQUFLLEVBQUUsdUJBQXVCO1NBQy9CLENBQUMsQ0FBQztRQUdILGNBQWM7UUFFaEIsTUFBTSxXQUFXLEdBQUcsSUFBSSxxQkFBTyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsYUFBYSxFQUFFO1lBQ3hELFNBQVMsRUFBRSxJQUFJLHFCQUFPLENBQUMsb0JBQW9CLEVBQUU7U0FDOUMsQ0FBQyxDQUFDO1FBR0gsTUFBTSxPQUFPLEdBQUcsSUFBSSxxQkFBTyxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsYUFBYSxFQUFFO1lBQ3ZELEdBQUcsRUFBRSxHQUFHO1lBQ1IsY0FBYyxFQUFFLHFCQUFPLENBQUMsY0FBYyxDQUFDLGtCQUFrQjtZQUN6RCxXQUFXLEVBQUUsV0FBVztZQUN4QixPQUFPLEVBQUUscUJBQU8sQ0FBQyxpQkFBaUIsQ0FBQyxLQUFLO1lBQ3hDLGVBQWUsRUFBRSxDQUFDO1lBQ2xCLFdBQVcsRUFBRSxhQUFhO1lBQzFCLGNBQWMsRUFBRTtnQkFDZCxxQkFBTyxDQUFDLG1CQUFtQixDQUFDLEdBQUc7Z0JBQy9CLHFCQUFPLENBQUMsbUJBQW1CLENBQUMsYUFBYTtnQkFDekMscUJBQU8sQ0FBQyxtQkFB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YXdzX2ttcywgXG4gIGF3c19zMyxcbiAgQ2ZuT3V0cHV0LCBcbiAgYXdzX2VjciwgXG4gIEF3cywgXG4gIGF3c19pYW0sIFxuICBhd3NfY29kZWJ1aWxkLCBcbiAgYXdzX2VrcywgXG4gIGF3c19jb2RlY29tbWl0LCBcbiAgYXdzX2NvZGVwaXBlbGluZSwgXG4gIGF3c19jb2RlcGlwZWxpbmVfYWN0aW9ucyxcbiAgYXdzX3NlY3JldHNtYW5hZ2VyLCBcbiAgYXdzX2VjMiB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHsgcGlwZWxpbmUgfSBmcm9tICdzdHJlYW0nO1xuXG5cbmV4cG9ydCBjbGFzcyBFa3NEZXZzZWNvcHNPYnNlcnZhYmlsaXR5U3RhY2sgZXh0ZW5kcyBTdGFjayB7XG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4vLyBGZXRjaCBleGlzdGluZyBWUENcblxuICAgIGNvbnN0IHZwYyA9IGF3c19lYzIuVnBjLmZyb21Mb29rdXAodGhpcywgJ1ZQQycsIHtcbiAgICAgIHZwY0lkOiAndnBjLTAxYjM0NzY4YTRlYjQ5ODBlJ1xuICAgIH0pO1xuXG5cbiAgICAvLyBFS1MgQ2x1c3RlclxuXG4gIGNvbnN0IGNsdXN0ZXJSb2xlID0gbmV3IGF3c19pYW0uUm9sZSh0aGlzLCAnQ2x1c3RlclJvbGUnLCB7XG4gICAgYXNzdW1lZEJ5OiBuZXcgYXdzX2lhbS5BY2NvdW50Um9vdFByaW5jaXBhbCgpXG4gIH0pO1xuXG5cbiAgY29uc3QgY2x1c3RlciA9IG5ldyBhd3NfZWtzLkNsdXN0ZXIodGhpcywgJ0VLU19DbHVzdGVyJywge1xuICAgIHZwYzogdnBjLFxuICAgIGVuZHBvaW50QWNjZXNzOiBhd3NfZWtzLkVuZHBvaW50QWNjZXNzLlBVQkxJQ19BTkRfUFJJVkFURSxcbiAgICBtYXN0ZXJzUm9sZTogY2x1c3RlclJvbGUsXG4gICAgdmVyc2lvbjogYXdzX2Vrcy5LdWJlcm5ldGVzVmVyc2lvbi5WMV8yMSxcbiAgICBkZWZhdWx0Q2FwYWNpdHk6IDAsXG4gICAgY2x1c3Rlck5hbWU6ICdla3MtY2x1c3RlcicsXG4gICAgY2x1c3RlckxvZ2dpbmc6IFtcbiAgICAgIGF3c19la3MuQ2x1c3RlckxvZ2dpbmdUeXBlcy5BUEksXG4gICAgICBhd3NfZWtzLkNsdXN0ZXJMb2dnaW5nVHlwZXMuQVVUSEVOVElDQVRPUixcbiAgICAgIGF3c19la3MuQ2x1c3RlckxvZ2dpbmdUeXBlcy5TQ0hFRFVMRVIsXG4gICAgICBhd3NfZWtzLkNsdXN0ZXJMb2dnaW5nVHlwZXMuQ09OVFJPTExFUl9NQU5BR0VSLFxuICAgICAgYXdzX2Vrcy5DbHVzdGVyTG9nZ2luZ1R5cGVzLkFVRElUXG4gICAgXSxcbiAgfSk7XG5cbiAgLy8gRW5hYmxlIGFjY2VzcyBmcm9tIHRoZSBjb25zb2xlIC0gY2hhbmdlIHRoZSB1c2VyIHRvIHRoZSBvbmUgeW91IHdhbnQgLSBJIGFtIHVzaW5nIFwib3BzXCJcblxuICBjb25zdCBhZGRDb25zb2xlQWNjZXNzID0gYXdzX2lhbS5Vc2VyLmZyb21Vc2VyTmFtZSh0aGlzLCBcImV4aXN0aW5nIGFkbWluXCIsIFwib3BzXCIpXG4gIGNsdXN0ZXIuYXdzQXV0aC5hZGRVc2VyTWFwcGluZyhhZGRDb25zb2xlQWNjZXNzLCB7IGdyb3VwcyA6IFtcInN5c3RlbTptYXN0ZXJzXCJdIH0pXG5cbi8vXG4vLyBDaG9pY2Ugb2YgTm9kZSBncm91cHMgd2l0aCBhbmQgd2l0aG91dCBMYXVuY2hUZW1wbGF0ZSBzcGVjaWZpY2F0aW9uc1xuLy9cblxuICBjbHVzdGVyLmFkZE5vZGVncm91cENhcGFjaXR5KCdleHRyYS1uZy13aXRob3V0LWx0Jywge1xuICAgIGluc3RhbmNlVHlwZXM6IFtcbiAgICAgIG5ldyBhd3NfZWMyLkluc3RhbmNlVHlwZSgndDMuc21hbGwnKSxcbiAgICBdLFxuICAgIG1pblNpemU6IDEsXG4gICAgbWF4U2l6ZTogMixcbiAgICBub2RlZ3JvdXBOYW1lOiAnZXh0cmEtbmctd2l0aG91dC1sdCcsXG4gIH0pO1xuXG4gIGNvbnN0IGxhdW5jaFRlbXBsYXRlUmVxdWlyZUltZHN2MkFzcGVjdCA9IG5ldyBhd3NfZWMyLkxhdW5jaFRlbXBsYXRlUmVxdWlyZUltZHN2MkFzcGVjdCgvKiBhbGwgb3B0aW9uYWwgcHJvcHMgKi8ge1xuICAgIHN1cHByZXNzV2FybmluZ3M6IGZhbHNlLFxuICB9KTtcblxuXG4gIGNvbnN0IHVzZXJEYXRhID0gYXdzX2VjMi5Vc2VyRGF0YS5mb3JMaW51eCgpO1xuICB1c2VyRGF0YS5hZGRDb21tYW5kcyhcbiAgICAnc2V0IC1vIHh0cmFjZScsXG4gICAgYC9ldGMvZWtzL2Jvb3RzdHJhcC5zaCAke2NsdXN0ZXIuY2x1c3Rlck5hbWV9YCxcbiAgKTtcblxuICBjb25zdCBsdCA9IG5ldyBhd3NfZWMyLkNmbkxhdW5jaFRlbXBsYXRlKHRoaXMsICdMYXVuY2hUZW1wbGF0ZScsIHtcbiAgICBcbiAgICBsYXVuY2hUZW1wbGF0ZURhdGE6IHtcbiAgICAgIGltYWdlSWQ6ICdhbWktMDYxOTQ0NzIyNjc4MDg4YjYnLCAvLyBjdXN0b20gQU1JXG4gICAgICBpbnN0YW5jZVR5cGU6ICd0My5zbWFsbCcsXG4gICAgICB1c2VyRGF0YTogRm4uYmFzZTY0KHVzZXJEYXRhLnJlbmRlcigpKSxcbiAgICAgIG1ldGFkYXRhT3B0aW9uczoge1xuICAgICAgICBodHRwVG9rZW5zOiAncmVxdWlyZWQnLFxuICAgICAgICBodHRwUHV0UmVzcG9uc2VIb3BMaW1pdDogMSxcbiAgICAgIH0sICAgICAgXG4gICAgfSxcbiAgfSk7XG5cblxuICBjbHVzdGVyLmFkZE5vZGVncm91cENhcGFjaXR5KCdleHRyYS1uZy13aXRoLWx0Jywge1xuICAgIGxhdW5jaFRlbXBsYXRlU3BlYzoge1xuICAgICAgaWQ6IGx0LnJlZixcbiAgICAgIHZlcnNpb246IGx0LmF0dHJMYXRlc3RWZXJzaW9uTnVtYmVyLFxuICAgICAgXG4gICAgfSxcbiAgfSk7XG5cblxuICAgIC8vIEVDUiBSZXBvc2l0b3J5IFxuXG4gICAgY29uc3QgZWNyUmVwbyA9IG5ldyBhd3NfZWNyLlJlcG9zaXRvcnkodGhpcywgJ2RldnNlY29wcy1yZXBvLWVjcicsIHsgXG4gIC8vICAgIHJlcG9zaXRvcnlOYW1lOiAnZGV2c2Vjb3BzLXJlcG8tZWNyJywgXG4gICAgICBlbmNyeXB0aW9uOiBhd3NfZWNyLlJlcG9zaXRvcnlFbmNyeXB0aW9uLktNUyxcbiAgICAgIGltYWdlVGFnTXV0YWJpbGl0eTogYXdzX2Vjci5UYWdNdXRhYmlsaXR5Lk1VVEFCTEUsXG4gICAgICBpbWFnZVNjYW5PblB1c2g6IHRydWVcbiAgICB9KTtcblxuICAgIGNvbnN0IHJlcG8gPSBuZXcgYXdzX2NvZGVjb21taXQuUmVwb3NpdG9yeSh0aGlzLCBcImRldnNlY29wcy1la3MtY2MtcmVwb3NpdG9yeVwiLCB7XG4gICAgICByZXBvc2l0b3J5TmFtZTogXCJkZXZzZWNvcHMtZWtzLWNjLXJlcG9zaXRvcnlcIixcbiAgICAgIGRlc2NyaXB0aW9uOiBcImRldnNlY29wcy1la3MtY2MtcmVwb3NpdG9yeVwiLFxuICAgIH0pO1xuXG5cbiAgICBjb25zdCBrbXNrZXkgPSBuZXcgYXdzX2ttcy5LZXkodGhpcywgJ015S2V5Jywge1xuICAgICAgZW5hYmxlS2V5Um90YXRpb246IHRydWUsXG4gICAgfSk7XG5cbmNvbnN0IGJ1aWxkUm9sZSA9IG5ldyBhd3NfaWFtLlJvbGUodGhpcywgJ0VLU0NvZGVCdWlsZFJvbGUnLCB7XG4gIGFzc3VtZWRCeTogbmV3IGF3c19pYW0uU2VydmljZVByaW5jaXBhbCgnY29kZWJ1aWxkLmFtYXpvbmF3cy5jb20nKSxcbiAgZGVzY3JpcHRpb246ICdFS1MgQ0IgUm9sZScsXG4gLy8gcm9sZU5hbWU6ICdFS1NDb2RlQnVpbGRSb2xlJyxcbn0pXG5cblxuYnVpbGRSb2xlLmFkZE1hbmFnZWRQb2xpY3koYXdzX2lhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnU2VjcmV0c01hbmFnZXJSZWFkV3JpdGUnKSlcblxuXG4vLyBGZXRjaCBEb2NrZXJIdWIgc2VjcmV0cyBmb3IgZG9ja2VyLWNsaSBsb2dpblxuXG5jb25zdCBkb2NrZXJodWIgPSBhd3Nfc2VjcmV0c21hbmFnZXIuU2VjcmV0LmZyb21TZWNyZXROYW1lVjIodGhpcywgJ2RvY2tlcmh1YicsICdkb2NrZXJodWInKVxuY29uc3QgZG9ja2VyaHVidHdvID0gYXdzX3NlY3JldHNtYW5hZ2VyLlNlY3JldC5mcm9tU2VjcmV0TmFtZVYyKHRoaXMsICdkb2NrZXJodWJ0d28nLCAnZG9ja2VyaHVidHdvJylcblxuYnVpbGRSb2xlLmFkZFRvUG9saWN5KFxuICBuZXcgYXdzX2lhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgIHNpZDogJ1N0c0FjY2VzcycsXG4gICAgYWN0aW9uczogW1xuICAgICAgXCJzdHM6QXNzdW1lUm9sZVwiLFxuICAgICAgXCJzdHM6U2V0U291cmNlSWRlbnRpdHlcIlxuICAgIF0sXG4gICAgcmVzb3VyY2VzOiBbXG4gICAgICBidWlsZFJvbGUucm9sZUFyblxuICAgIF0sXG4gIH0pLFxuKTtcblxuYnVpbGRSb2xlLmFkZFRvUG9saWN5KFxuICBuZXcgYXdzX2lhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgIHNpZDogJ1NlY3JldHNBY2Nlc3MnLFxuICAgIGFjdGlvbnM6IFtcbiAgICAgIFwic2VjcmV0c21hbmFnZXI6R2V0U2VjcmV0VmFsdWVcIlxuICAgIF0sXG4gICAgcmVzb3VyY2VzOiBbXG4gICAgICBkb2NrZXJodWIuc2VjcmV0QXJuLFxuICAgICAgZG9ja2VyaHVidHdvLnNlY3JldEFyblxuICAgIF0sXG4gIH0pLFxuKTtcblxuYnVpbGRSb2xlLmFkZFRvUG9saWN5KFxuICBuZXcgYXdzX2lhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgIHNpZDogJ0FjY2Vzc0RlY29kZUF1dGgnLFxuICAgIGFjdGlvbnM6IFtcbiAgICAgIFwic3RzOkRlY29kZUF1dGhvcml6YXRpb25NZXNzYWdlXCIsXG4gICAgXSxcbiAgICByZXNvdXJjZXM6IFtidWlsZFJvbGUucm9sZUFybl0sXG4gIH0pLFxuKTtcblxuYnVpbGRSb2xlLmFkZFRvUG9saWN5KFxuICBuZXcgYXdzX2lhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgIHNpZDogJ0Rlc2NyaWJlRUtTJyxcbiAgICBhY3Rpb25zOiBbXG4gICAgICAgIFwiZWtzOkRlc2NyaWJlQWRkb25cIixcbiAgICAgICAgXCJla3M6RGVzY3JpYmVDbHVzdGVyXCIsXG4gICAgICAgIFwiZWtzOkRlc2NyaWJlSWRlbnRpdHlQcm92aWRlckNvbmZpZ1wiLFxuICAgICAgICBcImVrczpEZXNjcmliZU5vZGVncm91cFwiLFxuICAgICAgICBcImVrczpEZXNjcmliZVVwZGF0ZVwiXG4gICAgXSxcbiAgICByZXNvdXJjZXM6IFtgJHtjbHVzdGVyLmNsdXN0ZXJBcm59YF0sXG4gIH0pLFxuKTtcblxuICAgIC8vIENPREVCVUlMRCAtIHByb2plY3QgLSBJYUMgU2VjdXJpdHlcblxuY29uc3QgY29kZWJ1aWxkQ2hlY2tvdiA9IG5ldyBhd3NfY29kZWJ1aWxkLlBpcGVsaW5lUHJvamVjdCh0aGlzLCBcImNka2RlcGxveWNoZWNrb3ZcIiwge1xuICBwcm9qZWN0TmFtZTogJ2Nka19zZWN1cml0eV9jaGVja19jaGVja292JyxcbiAgcm9sZTogYnVpbGRSb2xlLFxuICBlbmNyeXB0aW9uS2V5OiBrbXNrZXksXG4gIGVudmlyb25tZW50OiB7XG4gICAgICBjb21wdXRlVHlwZTogYXdzX2NvZGVidWlsZC5Db21wdXRlVHlwZS5TTUFMTCxcbiAgICAgIGJ1aWxkSW1hZ2U6IGF3c19jb2RlYnVpbGQuTGludXhCdWlsZEltYWdlLmZyb21Eb2NrZXJSZWdpc3RyeShcInB1YmxpYy5lY3IuYXdzL2Fja3N0b3JtL2NoZWNrb3Y6bGF0ZXN0XCIpLFxuICAgICAgcHJpdmlsZWdlZDogZmFsc2UsICAgICAgICAgIFxuICB9LFxuICBidWlsZFNwZWM6IGF3c19jb2RlYnVpbGQuQnVpbGRTcGVjLmZyb21PYmplY3Qoe1xuICB2ZXJzaW9uOiBcIjAuMlwiLFxuICBwaGFzZXM6IHtcbiAgICBidWlsZDoge1xuICAgICAgY29tbWFuZHM6IFtcbiAgICAgICAgJ3NraXBfY2hlY2tzPWBwYXN0ZSAtZCwgLXMga3ViZXJuZXRlcy9za2lwX2NoZWNrcy5jb25maWdgJyxcbiAgICAgICAgJ2NoZWNrb3YgLS1mcmFtZXdvcmsgY2xvdWRmb3JtYXRpb24gLS1za2lwLWNoZWNrICRza2lwX2NoZWNrcyAtZiBjZGsub3V0L0Vrc0RldnNlY29wc09ic2VydmFiaWxpdHlTdGFjay50ZW1wbGF0ZS5qc29uJyxcbiAgICAgIF1cbiAgICB9LFxuICB9LFxuICBhcnRpZmFjdHM6IHtcbiAgICBmaWxlczogW1xuICAgICAgJ2t1YmVybmV0ZXMvKicsXG4gICAgICAnRG9ja2VyZmlsZScsXG4gICAgICAncmVxdWlyZW1lbnRzLnR4dCcsXG4gICAgICAnc2VydmVyLnB5JyxcbiAgICBdXG4gIH1cbn0pXG59KTtcblxuICAgIC8vIENPREVCVUlMRCAtIHByb2plY3QgLSBTdGF0aWMgU2NhblxuICAgIFxuICAgIGNvbnN0IHByb2plY3QgPSBuZXcgYXdzX2NvZGVidWlsZC5Qcm9qZWN0KHRoaXMsICdkZXZzZWNvcHMtcHJvamVjdC1la3Mtc3RhdGljLXNjYW4nLCB7XG4gICAgICBwcm9qZWN0TmFtZTogJ2RldnNlY29wcy1wcm9qZWN0LWVrcy1zdGF0aWMtc2NhbicsXG4gICAgICByb2xlOiBidWlsZFJvbGUsXG4gICAgICBlbmNyeXB0aW9uS2V5OiBrbXNrZXksXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBidWlsZEltYWdlOiBhd3NfY29kZWJ1aWxkLkxpbnV4QnVpbGRJbWFnZS5BTUFaT05fTElOVVhfMl8yLFxuICAgICAgICBwcml2aWxlZ2VkOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIGVudmlyb25tZW50VmFyaWFibGVzOiB7XG4gICAgICAgICdFQ1JfUkVQT1NJVE9SWV9VUkknOiB7XG4gICAgICAgICAgdmFsdWU6IGAke2VjclJlcG8ucmVwb3NpdG9yeVVyaX1gXG4gICAgICAgIH0sXG4gICAgICAgICdBV1NfREVGQVVMVF9SRUdJT04nOiB7XG4gICAgICAgICAgdmFsdWU6IGAke0F3cy5SRUdJT059YFxuICAgICAgICB9LCAgXG4gICAgICAgICdIQURPTElOVF9JTUFHRV9UQUcnOiB7XG4gICAgICAgICAgdmFsdWU6IGBoYWRvbGludC1sYXRlc3RgXG4gICAgICAgICAgfSwgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICAgICAgICdJTUFHRV9SRVBPX05BTUUnOiB7XG4gICAgICAgIHZhbHVlOiBgJHtlY3JSZXBvLnJlcG9zaXRvcnlOYW1lfWBcbiAgICAgICB9LFxuICAgICAgICdBY2NvdW50X0lkJzoge1xuICAgICAgICB2YWx1ZTogYCR7QXdzLkFDQ09VTlRfSUR9YFxuICAgICAgfSwgXG4gICAgICAgJ0lNQUdFX1RBRyc6IHtcbiAgICAgICAgdmFsdWU6IGBhcHAtbGF0ZXN0YFxuICAgICAgIH0gICAgICAgXG4gICAgICB9LFxuICAgICAgYnVpbGRTcGVjOiBhd3NfY29kZWJ1aWxkLkJ1aWxkU3BlYy5mcm9tT2JqZWN0KHtcbiAgICAgICAgdmVyc2lvbjogXCIwLjJcIixcbiAgICAgICAgcGhhc2VzOiB7XG4gICAgICAgICAgaW5zdGFsbDoge1xuICAgICAgICAgICAgY29tbWFuZHM6IFtcbiAgICAgICAgICAgICAgICAnZW52JyxcbiAgICAgICAgICAgICAgICAvLyBPUFRJT05BTCAtIEJlbG93IHN0ZXBzIGFyZSB0byBlc2NhcGUgR2l0aHViIFJhdGUgbGltaXRzLiBZb3UgY2FuIHB1c2ggdG8gYSBwcml2YXRlIHJlcG9zaXRvcnkgbGlrZSBBbWF6b24gRUNSIGFueSBpbWFnZSBhbmQgcHVsbC9wdXNoIGluZmluaXRlbHkgICAgICBcbiAgICAgICAgICAgICAgICAnZXhwb3J0IFRBRz0ke0NPREVCVUlMRF9SRVNPTFZFRF9TT1VSQ0VfVkVSU0lPTn0nLFxuICAgICAgICAgICAgICAgICdleHBvcnQgZG9ja2VyaHViX3VzZXJuYW1lPWBhd3Mgc2VjcmV0c21hbmFnZXIgZ2V0LXNlY3JldC12YWx1ZSAtLXNlY3JldC1pZCBkb2NrZXJodWJ8IGpxIC0tcmF3LW91dHB1dCBcIi5TZWNyZXRTdHJpbmdcIiB8IGpxIC1yIC51c2VybmFtZWAnLFxuICAgICAgICAgICAgICAgICdleHBvcnQgZG9ja2VyaHViX3Bhc3N3b3JkPWBhd3Mgc2VjcmV0c21hbmFnZXIgZ2V0LXNlY3JldC12YWx1ZSAtLXNlY3JldC1pZCAgZG9ja2VyaHVidHdvfCBqcSAtLXJhdy1vdXRwdXQgXCIuU2VjcmV0U3RyaW5nXCIgfCBqcSAtciAucGFzc3dvcmRgJyxcbiAgICAgICAgICAgICAgICAnZWNobyBcIiMjIyMjIyMjIyMjI0xvZ2luIHRvIERvY2tlckh1YiMjIyMjIyMjIyMjI1wiJyxcbiAgICAgICAgICAgICAgICAnZG9ja2VyIGxvZ2luIC11ICRkb2NrZXJodWJfdXNlcm5hbWUgLXAgJGRvY2tlcmh1Yl9wYXNzd29yZCcsXG4gICAgICAgICAgICBdXG4gICAgICAgICAgfSxcbiAgICAgICAgICBidWlsZDoge1xuICAgICAgICAgICAgY29tbWFuZHM6IFtcbiAgICAgICAgICAgICAgJ21rZGlyIC1wICRDT0RFQlVJTERfU1JDX0RJUi9idWlsZC8nLFxuICAgICAgICAgICAgICAncHdkJyxcbiAgICAgICAgICAgICAgJ2xzJyxcbiAgICAgICAgICAgICAgJ2NwIGt1YmVybmV0ZXMvaGFkb2xpbnQueWFtbCAkQ09ERUJVSUxEX1NSQ19ESVIvYnVpbGQvaGFkb2xpbnQueWFtbCcsXG4gICAgICAgICAgICAgICdjcCBEb2NrZXJmaWxlICRDT0RFQlVJTERfU1JDX0RJUi9idWlsZC9Eb2NrZXJmaWxlJyxcbiAgICAgICAgICAgICAgJ2NwIHJlcXVpcmVtZW50cy50eHQgJENPREVCVUlMRF9TUkNfRElSL2J1aWxkL3JlcXVpcmVtZW50cy50eHQnLFxuICAgICAgICAgICAgICAnY3Agc2VydmVyLnB5ICRDT0RFQlVJTERfU1JDX0RJUi9idWlsZC9zZXJ2ZXIucHknLFxuICAgICAgICAgICAgICAnZWNobyBcIiMjIyMjIyMjIyMjI0RPQ0tFUiBGSUxFIExJTlQgU1RBVEdFIyMjIyMjIyMjIyMjXCInLFxuICAgICAgICAgICAgICAnRUNSX0xPR0lOPSQoYXdzIGVjciBnZXQtbG9naW4gLS1yZWdpb24gJEFXU19ERUZBVUxUX1JFR0lPTiAtLW5vLWluY2x1ZGUtZW1haWwpJyxcbiAgICAgICAgICAgICAgJ2VjaG8gXCIjIyMjIyMjIyMjIyNMb2dnaW5nIGluIHRvIEFtYXpvbiBFQ1IjIyMjIyMjIyMjIyNcIicsXG4gICAgICAgICAgICAgICckRUNSX0xPR0lOJyxcbiAgICAgICAgICAgICAgLy8gT1BUSU9OQUwgLSBCZWxvdyBzdGVwcyBhcmUgdG8gZXNjYXBlIEdpdGh1YiBSYXRlIGxpbWl0cy4gWW91IGNhbiBwdXNoIHRvIGEgcHJpdmF0ZSByZXBvc2l0b3J5IGxpa2UgQW1hem9uIEVDUiBhbnkgaW1hZ2UgYW5kIHB1bGwvcHVzaCBpbmZpbml0ZWx5ICAgICAgICAgICAgXG4gICAgICAgICAgICAgIC8vIGhhZG9saW50L2hhZG9saW50OnYxLjE2LjJcbiAgICAgICAgICAgICAgLy8gJ2RvY2tlciBydW4gLS1ybSAtaSAtdiAke1BXRH0vLmhhZG9saW50LnlhbWw6Ly5oYWRvbGludC55YW1sIGhhZG9saW50L2hhZG9saW50OmxhdGVzdCBoYWRvbGludCAtZiBqc29uIC0gPCAuL0RvY2tlcmZpbGUnLFxuICAgICAgICAgICAgICAvLydkb2NrZXIgcHVsbCAkRUNSX1JFUE9TSVRPUllfVVJJOiRIQURPTElOVF9JTUFHRV9UQUcnLFxuICAgICAgICAgICAgICAnY2QgJENPREVCVUlMRF9TUkNfRElSL2J1aWxkJyxcbiAgICAgICAgICAgICAgJ2xzIC10bHInLFxuICAgICAgICAgICAgICAvLydkb2NrZXIgcnVuIC0tcm0gLWkgLXYgJHtQV0R9L2hhZG9saW50LnlhbWw6Ly5oYWRvbGludC55YW1sICRFQ1JfUkVQT1NJVE9SWV9VUkk6JEhBRE9MSU5UX0lNQUdFX1RBRyBoYWRvbGludCAtZiBqc29uIC0gPCAuL0RvY2tlcmZpbGUnLFxuICAgICAgICAgICAgICAnZG9ja2VyIHJ1biAtLXJtIC1pIC12ICR7UFdEfS9oYWRvbGludC55YW1sOi8uaGFkb2xpbnQueWFtbCBoYWRvbGludC9oYWRvbGludDpsYXRlc3QgaGFkb2xpbnQgLWYganNvbiAtIDwgLi9Eb2NrZXJmaWxlJyxcbiAgICAgICAgICAgICAgJ2VjaG8gXCIjIyMjIyMjIyMjIyNET0NLRVIgRklMRSBMSU5UIFNUQVRHRSAtIFBBU1NFRCMjIyMjIyMjIyMjI1wiJyxcbiAgICAgICAgICAgICAgYGRvY2tlciBidWlsZCAtZiBEb2NrZXJmaWxlIC10ICRFQ1JfUkVQT1NJVE9SWV9VUkk6YXBwLWxhdGVzdCAuYCxcbiAgICAgICAgICAgICAgJ2RvY2tlciB0YWcgJEVDUl9SRVBPU0lUT1JZX1VSSTphcHAtbGF0ZXN0ICRFQ1JfUkVQT1NJVE9SWV9VUkk6JElNQUdFX1RBRycsXG4gICAgICAgICAgICAgICdkb2NrZXIgaGlzdG9yeSAtLW5vLXRydW5jICRFQ1JfUkVQT1NJVE9SWV9VUkk6JElNQUdFX1RBRydcbiAgICAgICAgICAgIF1cbiAgICAgICAgICB9LFxuICAgICAgICAgIHBvc3RfYnVpbGQ6IHtcbiAgICAgICAgICAgIGNvbW1hbmRzOiBbXG4gICAgICAgICAgICAgICdiYXNoIC1jIFwiaWYgWyAvXCIkQ09ERUJVSUxEX0JVSUxEX1NVQ0NFRURJTkcvXCIgPT0gL1wiMC9cIiBdOyB0aGVuIGV4aXQgMTsgZmlcIicsXG4gICAgICAgICAgICAgICdlY2hvIEJ1aWxkIGNvbXBsZXRlZCBvbiBgZGF0ZWAnLFxuICAgICAgICAgICAgICAnZG9ja2VyIHB1c2ggJEVDUl9SRVBPU0lUT1JZX1VSSTokSU1BR0VfVEFHJyxcbiAgICAgICAgICAgICAgJ2VjaG8gXCJEZWVwIFZ1bG5lcmFiaWxpdHkgU2NhbiBCeSBBbmNob3JlIEVuZ2luZVwiJyxcbiAgICAgICAgICAgICAgJ2VjaG8gXCJQT1NUX0JVSUxEIFBoYXNlIFdpbGwgZmFpbCBpZiBDb250YWluZXIgZmFpbHMgd2l0aCBWdWxuZXJhYmlsaXRpZXNcIicsXG4gICAgICAgICAgICAgICdleHBvcnQgQ09NUE9TRV9JTlRFUkFDVElWRV9OT19DTEk9MScsXG4gICAgICAgICAgICAgICdjdXJsIC1zIGh0dHBzOi8vY2ktdG9vbHMuYW5jaG9yZS5pby9pbmxpbmVfc2Nhbi12MC4zLjMgfCBiYXNoIC1zIC0tICRFQ1JfUkVQT1NJVE9SWV9VUkk6JElNQUdFX1RBRycsXG4gICAgICAgICAgICBdXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBhcnRpZmFjdHM6IHtcbiAgICAgICAgICBmaWxlczogW1xuICAgICAgICAgICAgJ2t1YmVybmV0ZXMvKicsXG4gICAgICAgICAgICAnRG9ja2VyZmlsZScsXG4gICAgICAgICAgICAncmVxdWlyZW1lbnRzLnR4dCcsXG4gICAgICAgICAgICAnc2VydmVyLnB5JyxcbiAgICAgICAgICBdXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSk7XG5cblxuICAgLy8gQ09ERUJVSUxEIC0gcHJvamVjdCAtIERlcGxveSB0byBFS1NcbiAgICBcbiAgIGNvbnN0IHByb2plY3RFa3MgPSBuZXcgYXdzX2NvZGVidWlsZC5Qcm9qZWN0KHRoaXMsICdkZXZzZWNvcHMtcHJvamVjdC1la3MtZGVwbG95Jywge1xuICAgIHByb2plY3ROYW1lOiAnZGV2c2Vjb3BzLXByb2plY3QtZWtzLWRlcGxveScsXG4gICAgcm9sZTogYnVpbGRSb2xlLFxuICAgIGVuY3J5cHRpb25LZXk6IGttc2tleSxcbiAgICBlbnZpcm9ubWVudDoge1xuICAgICAgYnVpbGRJbWFnZTogYXdzX2NvZGVidWlsZC5MaW51eEJ1aWxkSW1hZ2UuQU1BWk9OX0xJTlVYXzJfMixcbiAgICAgIHByaXZpbGVnZWQ6IHRydWUsXG4gICAgfSxcbiAgICBlbnZpcm9ubWVudFZhcmlhYmxlczoge1xuICAgICAgJ0VDUl9SRVBPU0lUT1JZX1VSSSc6IHtcbiAgICAgICAgdmFsdWU6IGAke2VjclJlcG8ucmVwb3NpdG9yeVVyaX1gXG4gICAgICB9LFxuICAgICAgJ0FXU19ERUZBVUxUX1JFR0lPTic6IHtcbiAgICAgICAgdmFsdWU6IGAke0F3cy5SRUdJT059YFxuICAgICAgfSxcbiAgICAgICdBV1NfQ0xVU1RFUl9OQU1FJzoge1xuICAgICAgICB2YWx1ZTogYCR7Y2x1c3Rlci5jbHVzdGVyTmFtZX1gXG4gICAgICB9LCAgICAgICBcbiAgICAgICdIQURPTElOVF9JTUFHRV9UQUcnOiB7XG4gICAgICAgIHZhbHVlOiBgaGFkb2xpbnQtbGF0ZXN0YFxuICAgICAgfSwgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICAgICAnSU1BR0VfUkVQT19OQU1FJzoge1xuICAgICAgdmFsdWU6IGAke2VjclJlcG8ucmVwb3NpdG9yeU5hbWV9YFxuICAgICAgfSxcbiAgICAgJ0FjY291bnRfSWQnOiB7XG4gICAgICB2YWx1ZTogYCR7QXdzLkFDQ09VTlRfSUR9YFxuICAgICB9LCBcbiAgICAgJ0lNQUdFX1RBRyc6IHtcbiAgICAgIHZhbHVlOiBgYXBwLWxhdGVzdGBcbiAgICAgfSAgICAgICBcbiAgICB9LFxuICAgIGJ1aWxkU3BlYzogYXdzX2NvZGVidWlsZC5CdWlsZFNwZWMuZnJvbU9iamVjdCh7XG4gICAgICB2ZXJzaW9uOiBcIjAuMlwiLFxuICAgICAgcGhhc2VzOiB7IFxuICAgICAgICBwcmVfYnVpbGQ6IHtcbiAgICAgICAgICBjb21tYW5kczogW1xuICAgICAgICAgICAgJ2VjaG8gXCIjIyMjIyMjIyMjIyNJbnN0YWxsaW5nIGFwcCBkZXBlbmRlbmNpZXMjIyMjIyMjIyMjIyNcIicsXG4gICAgICAgICAgICAnY3VybCAtbyBrdWJlY3RsIGh0dHBzOi8vYW1hem9uLWVrcy5zMy51cy13ZXN0LTIuYW1hem9uYXdzLmNvbS8xLjE4LjkvMjAyMC0xMS0wMi9iaW4vbGludXgvYW1kNjQva3ViZWN0bCcsXG4gICAgICAgICAgICAnY2htb2QgK3ggLi9rdWJlY3RsJyxcbiAgICAgICAgICAgICdta2RpciAtcCAkSE9NRS9iaW4gJiYgY3AgLi9rdWJlY3RsICRIT01FL2Jpbi9rdWJlY3RsICYmIGV4cG9ydCBQQVRIPSRQQVRIOiRIT01FL2JpbicsXG4gICAgICAgICAgICAnZXhwb3J0IFBBVEg9JFBBVEg6JEhPTUUvYmluID4+IH4vLmJhc2hyYycsXG4gICAgICAgICAgICAnc291cmNlIH4vLmJhc2hyYycsXG4gICAgICAgICAgICAnZWNobyBcIiMjIyMjIyMjIyMjI0NoZWNrIGt1YmVjdGwgdmVyc2lvbiMjIyMjIyMjIyMjI1wiJyxcbiAgICAgICAgICAgICdrdWJlY3RsIHZlcnNpb24gLS1zaG9ydCAtLWNsaWVudCcsXG4gICAgICAgICAgICAnZWNobyBcIiMjIyMjIyMjIyMjI2NoZWNrIGNvbmZpZyMjIyMjIyMjIyMjI1wiJywgICAgICAgXG4gICAgICAgICAgICAnYXdzIGVrcyB1cGRhdGUta3ViZWNvbmZpZyAtLW5hbWUgJEFXU19DTFVTVEVSX05BTUUgLS1yZWdpb24gJEFXU19ERUZBVUxUX1JFR0lPTicsXG4gICAgICAgICAgICAna3ViZWN0bCBjb25maWcgdmlldyAtLW1pbmlmeScsXG4gICAgICAgICAgICAna3ViZWN0bCBnZXQgY29uZmlnbWFwIGF3cy1hdXRoIC1vIHlhbWwgLW4ga3ViZS1zeXN0ZW0nLFxuICAgICAgICAgIF1cbiAgICAgICAgfSxcbiAgICAgICAgYnVpbGQ6IHtcbiAgICAgICAgICBjb21tYW5kczogW1xuICAgICAgICAgICAgJ2VjaG8gXCIjIyMjIyMjIyMjIyNEZXBsb3kgdG8gRUtTIENsdXN0ZXIjIyMjIyMjIyMjIyNcIicsICAgICAgICAgIFxuICAgICAgICAgICAgJ2t1YmVjdGwgYXBwbHkgLWYga3ViZXJuZXRlcy9kZXBsb3ltZW50LnlhbWwnLFxuICAgICAgICAgICAgJ2VjaG8gXCIjIyMjIyMjIyMjIyNMaXN0IFBvZHMjIyMjIyMjIyMjIyNcIicsICAgICAgICAgICAgXG4gICAgICAgICAgICAna3ViZWN0bCBnZXQgcG9kcycsXG4gICAgICAgICAgICAnZG9ja2VyIGltYWdlcycsXG4gICAgICAgICAgXVxuICAgICAgICB9XG4gICAgICB9LFxuICAgIH0pXG4gIH0pOyAgICBcblxuXG5cblxuICBjbHVzdGVyLmF3c0F1dGguYWRkTWFzdGVyc1JvbGUocHJvamVjdEVrcy5yb2xlISk7XG4gIHByb2plY3QuYWRkVG9Sb2xlUG9saWN5KG5ldyBhd3NfaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgYWN0aW9uczogW1xuICAgICAgXCJla3M6RGVzY3JpYmVBZGRvblwiLFxuICAgICAgXCJla3M6RGVzY3JpYmVDbHVzdGVyXCIsXG4gICAgICBcImVrczpEZXNjcmliZUlkZW50aXR5UHJvdmlkZXJDb25maWdcIixcbiAgICAgIFwiZWtzOkRlc2NyaWJlTm9kZWdyb3VwXCIsXG4gICAgICBcImVrczpEZXNjcmliZVVwZGF0ZVwiXG4gICAgXSxcbiAgICByZXNvdXJjZXM6IFtgJHtjbHVzdGVyLmNsdXN0ZXJBcm59YF0sXG4gIH0pKTtcblxuLy8gUGlwbGVpbmUgZm9yIEVLU1xuXG4gICAgY29uc3Qgc291cmNlT3V0cHV0ID0gbmV3IGF3c19jb2RlcGlwZWxpbmUuQXJ0aWZhY3QoKTtcbiAgICBjb25zdCBidWlsZE91dHB1dCA9IG5ldyBhd3NfY29kZXBpcGVsaW5lLkFydGlmYWN0KCk7XG4gICAgY29uc3QgYnVpbGRjaGVja292T3V0cHV0ID0gbmV3IGF3c19jb2RlcGlwZWxpbmUuQXJ0aWZhY3QoKTtcbiAgICBjb25zdCBkZXBsb3lPdXRwdXQgPSBuZXcgYXdzX2NvZGVwaXBlbGluZS5BcnRpZmFjdCgpO1xuXG4gICAgY29uc3Qgc291cmNlQWN0aW9uID0gbmV3IGF3c19jb2RlcGlwZWxpbmVfYWN0aW9ucy5Db2RlQ29tbWl0U291cmNlQWN0aW9uKHtcbiAgICAgIGFjdGlvbk5hbWU6ICdDb2RlQ29tbWl0X1NvdXJjZScsXG4gICAgICByZXBvc2l0b3J5OiByZXBvLFxuICAgICAgYnJhbmNoOiAnbWFpbicsXG4gICAgICBvdXRwdXQ6IHNvdXJjZU91dHB1dFxuICAgIH0pO1xuXG4gICAgY29uc3QgY2hlY2tvdkFjdGlvbiA9IG5ldyBhd3NfY29kZXBpcGVsaW5lX2FjdGlvbnMuQ29kZUJ1aWxkQWN0aW9uKHtcbiAgICAgIGFjdGlvbk5hbWU6ICdDb2RlQnVpbGQnLFxuICAgICAgcHJvamVjdDogY29kZWJ1aWxkQ2hlY2tvdixcbiAgICAgIGlucHV0OiBzb3VyY2VPdXRwdXQsXG4gICAgICBvdXRwdXRzOiBbYnVpbGRjaGVja292T3V0cHV0XSwgXG4gICAgfSk7XG5cbiAgICBjb25zdCBidWlsZEFjdGlvbiA9IG5ldyBhd3NfY29kZXBpcGVsaW5lX2FjdGlvbnMuQ29kZUJ1aWxkQWN0aW9uKHtcbiAgICAgIGFjdGlvbk5hbWU6ICdDb2RlQnVpbGQnLFxuICAgICAgcHJvamVjdDogcHJvamVjdCxcbiAgICAgIGlucHV0OiBidWlsZGNoZWNrb3ZPdXRwdXQsXG4gICAgICBvdXRwdXRzOiBbYnVpbGRPdXRwdXRdLCBcbiAgICB9KTtcblxuICAgIGNvbnN0IG1hbnVhbEFwcHJvdmFsQWN0aW9uID0gbmV3IGF3c19jb2RlcGlwZWxpbmVfYWN0aW9ucy5NYW51YWxBcHByb3ZhbEFjdGlvbih7XG4gICAgICBhY3Rpb25OYW1lOiAnQXBwcm92ZScsXG4gICAgfSk7XG5cbiAgICBjb25zdCBkZXBsb3lBY3Rpb24gPSBuZXcgYXdzX2NvZGVwaXBlbGluZV9hY3Rpb25zLkNvZGVCdWlsZEFjdGlvbih7XG4gICAgICBhY3Rpb25OYW1lOiAnQ29kZUJ1aWxkJyxcbiAgICAgIHByb2plY3Q6IHByb2plY3RFa3MsXG4gICAgICBpbnB1dDogYnVpbGRPdXRwdXQsXG4gICAgICBvdXRwdXRzOiBbZGVwbG95T3V0cHV0XSwgXG4gICAgfSk7XG5cbm5ldyBhd3NfY29kZXBpcGVsaW5lLlBpcGVsaW5lKHRoaXMsICdkZXZzZWNvcHMtcHJvamVjdC1la3MtcGlwZWxpbmUnLCB7XG4gICAgICBzdGFnZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIHN0YWdlTmFtZTogJ1NvdXJjZS1JbnB1dCcsXG4gICAgICAgICAgYWN0aW9uczogW3NvdXJjZUFjdGlvbl0sXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBzdGFnZU5hbWU6ICdDaGVja292LUlhQy1Db2RlLVNlY3VyaXR5LUNoZWNrcycsXG4gICAgICAgICAgYWN0aW9uczogW2NoZWNrb3ZBY3Rpb25dLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgc3RhZ2VOYW1lOiAnQXBwcm92ZS1DaGVja292LUNoZWNrcycsXG4gICAgICAgICAgYWN0aW9uczogW21hbnVhbEFwcHJvdmFsQWN0aW9uXSxcbiAgICAgICAgfSwgICAgICAgICAgICAgICAgXG4gICAgICAgIHtcbiAgICAgICAgICBzdGFnZU5hbWU6ICdDb250YWluZXItU2Nhbi1IYWRvbGludC1BbmNob3JlRW5naW5lJyxcbiAgICAgICAgICBhY3Rpb25zOiBbYnVpbGRBY3Rpb25dLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgc3RhZ2VOYW1lOiAnQXBwcm92ZS1EZXBsb3ltZW50JyxcbiAgICAgICAgICBhY3Rpb25zOiBbbWFudWFsQXBwcm92YWxBY3Rpb25dLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgc3RhZ2VOYW1lOiAnRGVwbG95LXRvLUVLUycsXG4gICAgICAgICAgYWN0aW9uczogW2RlcGxveUFjdGlvbl0sXG4gICAgICAgIH1cbiAgICAgIF1cbiAgICB9KTtcblxuXG5cblxuICAgIGVjclJlcG8uZ3JhbnRQdWxsUHVzaChwcm9qZWN0LnJvbGUhKVxuICAgIHByb2plY3QuYWRkVG9Sb2xlUG9saWN5KG5ldyBhd3NfaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgIFwiZWNyOkdldEF1dGhvcml6YXRpb25Ub2tlblwiLFxuICAgICAgICBcImVjcjpCYXRjaENoZWNrTGF5ZXJBdmFpbGFiaWxpdHlcIixcbiAgICAgICAgXCJlY3I6QmF0Y2hHZXRJbWFnZVwiLFxuICAgICAgICBcImVjcjpHZXREb3dubG9hZFVybEZvckxheWVyXCJcbiAgICAgICAgXSxcbiAgICAgIHJlc291cmNlczogW2VjclJlcG8ucmVwb3NpdG9yeUFybl1cbiAgICB9KSk7XG4gIFxuXG5cblxuICAgICAgLy8gY3JlYXRlIGFuIE91dHB1dFxuICAgICAgXG4gICAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMsICdFS1NfQ2x1c3Rlcl9OYW1lJywge1xuICAgICAgICB2YWx1ZTogY2x1c3Rlci5jbHVzdGVyTmFtZSxcbiAgICAgICAgZGVzY3JpcHRpb246ICdFS1MgQ2x1c3RlcicsXG4gICAgICAgIGV4cG9ydE5hbWU6ICdFS1NDbHVzdGVyTmFtZScsXG4gICAgICB9KTtcbiAgICAgIG5ldyBDZm5PdXRwdXQodGhpcywgJ0VDUlJlcG8nLCB7XG4gICAgICAgIHZhbHVlOiBlY3JSZXBvLnJlcG9zaXRvcnlOYW1lLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ0VDUiBSZXBvJyxcbiAgICAgICAgZXhwb3J0TmFtZTogJ0VDUnJlcG8nLFxuICAgICAgfSk7IFxuICAgICAgbmV3IENmbk91dHB1dCh0aGlzLCAnQ29kZUNvbW1pdFJlcG8nLCB7XG4gICAgICAgIHZhbHVlOiByZXBvLnJlcG9zaXRvcnlOYW1lLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ0NDUmVwbycsXG4gICAgICAgIGV4cG9ydE5hbWU6ICdDQ3JlcG8nLFxuICAgICAgfSk7IFxuICAgICAgbmV3IENmbk91dHB1dCh0aGlzLCAnQ29kZVBpcGVsaW5lTmFtZScsIHtcbiAgICAgICAgdmFsdWU6IHBpcGVsaW5lLm5hbWUsXG4gICAgICAgIGRlc2NyaXB0aW9uOiAnQ29kZVBpcGVsaW5lJyxcbiAgICAgICAgZXhwb3J0TmFtZTogJ0NQTmFtZScsXG4gICAgICB9KTsgXG4gICAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMsICdTdGF0aWNTY2FuQ29kZUJ1aWxkJywge1xuICAgICAgICB2YWx1ZTogcHJvamVjdC5wcm9qZWN0TmFtZSxcbiAgICAgICAgZGVzY3JpcHRpb246ICdTdGFpY1NjYW4gQ29kZUJ1aWxkJyxcbiAgICAgICAgZXhwb3J0TmFtZTogJ1N0YXRpY1NjYW5Qcm9qZWN0JyxcbiAgICAgIH0pOyBcbiAgICAgIG5ldyBDZm5PdXRwdXQodGhpcywgJ0VLU0RlcGxveUNvZGVCdWlsZCcsIHtcbiAgICAgICAgdmFsdWU6IHByb2plY3RFa3MucHJvamVjdE5hbWUsXG4gICAgICAgIGRlc2NyaXB0aW9uOiAnRUtTRGVwbG95IENvZGVCdWlsZCcsXG4gICAgICAgIGV4cG9ydE5hbWU6ICdFS1NEZXBsb3lQcm9qZWN0JyxcbiAgICAgIH0pOyBcbiAgICAgIG5ldyBDZm5PdXRwdXQodGhpcywgJ0NoZWNrb3ZDb2RlQnVpbGQnLCB7XG4gICAgICAgIHZhbHVlOiBjb2RlYnVpbGRDaGVja292LnByb2plY3ROYW1lLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ0NoZWNrb3YgQ29kZUJ1aWxkJyxcbiAgICAgICAgZXhwb3J0TmFtZTogJ0NoZWNrb3ZQcm9qZWN0JyxcbiAgICAgIH0pOyBcbiAgfVxufVxuIl19