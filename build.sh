#!/usr/bin/env bash

VERSION_TAG=latest

if [[ -v QUIZZAPP_IMAGE_REPOSITORY ]]; then
	TIMESTAMP=`date +%y%m%d%H%M%S`
	BUILD_TAG=$QUIZZAPP_IMAGE_REPOSITORY:build-$TIMESTAMP
	RELEASE_TAG=$QUIZZAPP_IMAGE_REPOSITORY:$VERSION_TAG

	docker build --network=host -t=$BUILD_TAG -t $RELEASE_TAG .
	docker push -a $QUIZZAPP_IMAGE_REPOSITORY

else
	docker build --network=host -t=quizzapp:$VERSION_TAG .

fi
