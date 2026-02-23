pipeline {
    agent any

    tools {
        nodejs 'NodeJS 18'
    }

    environment {
        // Define credentials IDs here. Ensure these match the IDs in Jenkins Credentials.
        STAGING_DB_URL = credentials('STAGING_DATABASE_URL')
        STAGING_DIR_URL = credentials('STAGING_DIRECT_URL')
    }

    stages {
        stage('Install Dependencies') {
            steps {
                sh 'npm ci'
            }
        }

        stage('Lint') {
            steps {
                sh 'npm run lint'
            }
        }

        stage('Test') {
            steps {
                sh 'npm test'
            }
        }

        stage('Build') {
            steps {
                sh 'npm run build'
            }
        }

        stage('Database Migration') {
            when {
                anyOf {
                    branch 'staging'
                    branch 'master'
                }
            }
            steps {
                script {
                    echo "Running migrations for branch ${env.BRANCH_NAME}..."
                    withEnv(["DATABASE_URL=${env.STAGING_DB_URL}", "DIRECT_URL=${env.STAGING_DIR_URL}"]) {
                        sh 'npx prisma migrate deploy'
                    }
                }
            }
        }
    }

    post {
        always {
            cleanWs()
        }
        success {
            echo 'Build and Test successful!'
        }
        failure {
            echo 'Build or Test failed. Please check the logs.'
        }
    }
}
