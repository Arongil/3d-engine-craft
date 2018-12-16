class CollisionBox {

	constructor(parent, render = true, hasBlenderModel = false, modelFormatType = '', hasBlenderAnimation = false) {
		// The collision box is from the center of the parent NPC and extends outward to make a box with dimension according to the size of the parent (x, y, z lengths).
		this.parent = parent; // The object for which the collision box is designed. Whatever it is, it needs two things: a pos vector and a size vector.
		this.uncollideSteps = 10; // The steps the CollisionBox will binary search to correctly "unstuck" the object.

		this.render = true;
		this.hasBlenderModel = hasBlenderModel;
		this.modelFormatType = modelFormatType;
		this.hasBlenderAnimation = hasBlenderAnimation;

		// borrowed from https://stackoverflow.com/questions/44505771/animations-in-three-js-with-gltf-from-blender-exporter
		this.mixer = null;
		this.clock = new THREE.Clock();

		this.isPlayingAnimation = false;
		this.canClick = true;
	}

	static isInside(aPos, aSize, bPos, bSize) {
		var pos = aPos, size = aSize,
				otherPos = bPos, otherSize = bSize;
		return pos.x + size.x/2 > otherPos.x - otherSize.x/2 && pos.x - size.x/2 < otherPos.x + otherSize.x/2 && // x-axis
			pos.y + size.y/2 > otherPos.y - otherSize.y/2 && pos.y - size.y/2 < otherPos.y + otherSize.y/2 && // y-axis
			pos.z + size.z/2 > otherPos.z - otherSize.z/2 && pos.z - size.z/2 < otherPos.z + otherSize.z/2;   // z-axis
	}

	get pos() {
		return this.parent.pos;
	}

	get vel() {
		return this.parent.vel;
	}

	get size() {
		return this.parent.size;
	}

	initRender() {
		if(this.hasBlenderModel) {

			if(this.modelFormatType == 'fbx') {
				var loader = new THREE.FBXLoader();
				var _this = this;
				loader.load(this.parent.texturePath,function(object){
						_this.geometry = object.geometry;
						_this.material = object.material;
						_this.cube = object;
						_this.parent.GC.ThreeScene.add(object);
						},undefined,function(error){console.error('error:' + error)});
			}

			else if(this.modelFormatType == 'collada') {
				var loader = new THREE.ColladaLoader();
				var _this = this;
				loader.load(this.parent.texturePath,function(object){
						_this.cube = object.scene.children[0];
						_this.geometry = _this.cube.geometry;
						_this.material = new THREE.MeshNormalMaterial({'morphTargets':true});
						_this.parent.GC.ThreeScene.add(_this.cube);
						});
			}

			else if(this.modelFormatType == 'glb' || this.modelFormatType == 'gltf'){
				var loader = new THREE.GLTFLoader();
				var _this = this;

				loader.load(this.parent.texturePath, function(gltf) {
						_this.cube = gltf.scene.children[0];
						_this.geometry = _this.cube.geometry;
						_this.material = _this.cube.material;

						_this.parent.GC.ThreeScene.add(gltf.scene);

						_this.gltf = gltf;

						_this.frustumCalled = false;
						if(_this.hasBlenderAnimation){
						_this.mixer = new THREE.AnimationMixer(gltf.scene);
						_this.mixer.clipAction(gltf.animations[_this.parent.blenderAnimationIndex]).play();
						_this.animation = _this.mixer.clipAction(gltf.animations[_this.parent.blenderAnimationIndex]);
						//_this.mixer.clipAction(gltf.animations[0]).paused = true;
						}
						}, undefined, function(error) {
						console.log(error);
						});

			}

		}
		else {

			this.geometry = new THREE.BoxGeometry(this.parent.size.x, this.parent.size.y, this.parent.size.z);
			if (this.parent.texturePath !== "") {
				this.material = new THREE.MeshBasicMaterial( { map: new THREE.TextureLoader().load( this.parent.texturePath ) } );
			}
			else {
				this.material = new THREE.MeshPhongMaterial( { color: parseInt(this.parent.color) } );
			}
			this.cube = new THREE.Mesh( this.geometry, this.material );
			this.parent.GC.ThreeScene.add( this.cube );

		}
	}

	display() {
		if(this.mixer != null){
			this.mixer.update(this.clock.getDelta());
		}	
		var result = this.pos.getShifted(this.parent.renderDisplacement || new Vector3D(0,0,0));
		this.cube.position.set(result.x,result.y,result.z);
	}

	isInside(other) {
		return CollisionBox.isInside(this.pos, this.size, other.pos, other.size);
	}

	collideWith(other) {
		if (!this.isInside(other)) {
			return false;
		}
		// Reposition the NPC such that it is no longer inside the other object.
		// Binary search the optimal distance to extract it: more than nothing, less than the entire negative velocity.
		var vel = this.parent.vel.getShifted(other.vel.getScaled(-1));
		if (vel.x === 0 && vel.y === 0 && vel.z === 0) {
			vel = new Vector3D(0, -1, 0); // The last resort is to force the object to move up.
		}
		var high = 0, low = -1, mid, i;
		for (i = 0; i < this.uncollideSteps; i++) {
			mid = (high + low) / 2;
			if (CollisionBox.isInside(this.pos.getShifted( vel.getScaled(mid) ), this.size, other.pos, other.size)) {
				high = mid; // If the middle box is still inside, then the box needs to go out farther.
			}
			else {
				low = mid; // If the middle box is still inside, then the box needs to go out less.
			}
		}
		// There are only three directions because everything is constrained to
		// align with the axes. Thus, only one component of the velocity is
		// necessary to extract the object. We test them all.
		var xShifted = this.pos.clone();
		xShifted.x += vel.x * low;
		if (!CollisionBox.isInside(xShifted, this.size, other.pos, other.size)) {
			this.parent.vel.x = other.vel.x;
			this.parent.vel.y = (this.parent.vel.y - other.vel.y)*(other.friction !== undefined ? other.friction : 1) + other.vel.y;
			this.parent.vel.z = (this.parent.vel.z - other.vel.z)*(other.friction !== undefined ? other.friction : 1) + other.vel.z;
			this.parent.pos = xShifted;
			return false;
		}
		var yShifted = this.pos.clone();
		yShifted.y += vel.y * low;
		if (!CollisionBox.isInside(yShifted, this.size, other.pos, other.size)) {
			this.parent.vel.y = other.vel.y;
			this.parent.vel.x = (this.parent.vel.x - other.vel.x)*(other.friction !== undefined ? other.friction : 1) + other.vel.x;
			this.parent.vel.z = (this.parent.vel.z - other.vel.z)*(other.friction !== undefined ? other.friction : 1) + other.vel.z;
			this.parent.pos = yShifted;
			return true; // Only return true if the object lands on the top of a surface.
		}
		var zShifted = this.pos.clone();
		zShifted.z += vel.z * low;
		if (!CollisionBox.isInside(zShifted, this.size, other.pos, other.size)) {
			this.parent.vel.z = other.vel.z;
			this.parent.vel.x = (this.parent.vel.x - other.vel.x)*(other.friction !== undefined ? other.friction : 1) + other.vel.x;
			this.parent.vel.y = (this.parent.vel.y - other.vel.y)*(other.friction !== undefined ? other.friction : 1) + other.vel.y;
			this.parent.pos = zShifted;
			return false;
		}
		// If for whatever reason the object is not axis-aligned, zero all velocity. 
		this.pos.shift( this.parent.vel.getScaled(low) );
		this.parent.vel.scale(0);
		return false;
	}
}
